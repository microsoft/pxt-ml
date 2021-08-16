namespace jacdac {
    export class MLServer extends Server {
        protected autoInvokeSamples = 0
        protected execTime = 0
        protected outputs = Buffer.create(0)
        protected lastError: string
        protected lastRunNumSamples = 0
        protected formatVersion = 0

        constructor(nam: string, protected format: number, protected agg: SensorAggregatorServer) {
            super(nam, jacdac.SRV_MODEL_RUNNER);
            agg.newDataCallback = () => {
                if (this.autoInvokeSamples && this.lastRunNumSamples >= 0 &&
                    this.numSamples - this.lastRunNumSamples >= this.autoInvokeSamples) {
                    this.lastRunNumSamples = -1
                    control.runInBackground(() => this.runModel())
                }
            }
        }

        get numSamples() {
            return this.agg.numSamples
        }

        get modelBuffer() {
            const bufs = binstore.buffers()
            if (!bufs || !bufs[0]) return null
            if (bufs[0].getNumber(NumberFormat.Int32LE, 0) == -1)
                return null
            return bufs[0]
        }

        get modelSize() {
            const m = this.modelBuffer
            if (m) return m.length
            else return 0
        }

        protected invokeModel() { }
        protected eraseModel() {
            binstore.erase()
        }
        protected loadModelImpl() { }

        get inputShape(): number[] {
            return null
        }

        get outputShape(): number[] {
            return null
        }

        get arenaBytes() {
            return 0
        }

        protected error(msg: string) {
            if (msg)
                control.dmesg("ML-error: " + msg)
            this.lastError = msg
        }

        protected catchHandler(err: any) {
            if (typeof err != "string") {
                control.dmesgValue(err)
                err = "[dmesg above]"
            }
            this.error(err)
        }

        private runModel() {
            if (this.lastError) return
            const numSamples = this.numSamples
            const t0 = control.micros()
            this.invokeModel()
            this.execTime = control.micros() - t0
            this.lastRunNumSamples = numSamples
            this.sendReport(JDPacket.from(CMD_GET_REG | ModelRunnerReg.Outputs, this.outputs))
        }

        start() {
            super.start()
            this.agg.start()
            this.loadModel()
        }

        private loadModel() {
            this.lastError = null
            if (!this.modelBuffer)
                return this.error("no model")
            this.loadModelImpl()
            if (this.lastError) {
                this.agg.samplesInWindow = 0
                return
            }
            let inp = this.inputShape
            if (inp) {
                inp = this.inputShape.filter(v => v != 1)
                const ss = this.agg.sampleSize >> 2
                const elts = ml.shapeElements(inp)
                let win = Math.idiv(elts, ss)
                if (ss * win != elts) {
                    this.error(`aggregator sample size: ${ss} doesn't divide input size ${elts}`)
                    win = 0
                }
                control.dmesg(`set sample window to: ${win}`)
                this.agg.samplesInWindow = win
            }
        }

        protected transformFirstBlockOfModel(buf: Buffer) {
            return buf
        }

        private readModel(packet: JDPacket) {
            const sz = packet.intData
            console.log(`model ${sz} bytes (of ${binstore.totalSize()})`)
            if (sz > binstore.totalSize() - 8)
                return
            this.eraseModel()
            const flash = binstore.addBuffer(sz)
            const pipe = new InPipe()
            this.sendReport(JDPacket.jdpacked(packet.serviceCommand, "u16", [pipe.port]))
            console.log(`pipe ${pipe.port}`)
            let off = 0
            const headBuffer = Buffer.create(8)
            this.lastError = null
            try {
                while (true) {
                    let buf = pipe.read()
                    if (!buf)
                        return
                    if (off == 0) {
                        buf = this.transformFirstBlockOfModel(buf)
                        // don't write the header before we finish
                        headBuffer.write(0, buf)
                        binstore.write(flash, 8, buf.slice(8))
                    } else {
                        binstore.write(flash, off, buf)
                    }
                    off += buf.length
                    if (off >= sz) {
                        // now that we're done, write the header
                        binstore.write(flash, 0, headBuffer)
                        // and reset, so we're sure the GC heap is not fragmented when we allocate new arena
                        //control.reset()
                        break
                    }
                    if (off & 7)
                        throw "invalid model stream size"
                }
            } catch (e) {
                this.catchHandler(e)
            }
            pipe.close()
            if (!this.lastError)
                this.loadModel()
        }

        handlePacket(packet: JDPacket) {
            this.handleRegUInt32(packet, ModelRunnerReg.AllocatedArenaSize, this.arenaBytes)
            this.handleRegUInt32(packet, ModelRunnerReg.LastRunTime, this.execTime)
            this.handleRegUInt32(packet, ModelRunnerReg.ModelSize, this.modelSize)
            this.handleRegUInt32(packet, ModelRunnerReg.Format, this.format)
            this.handleRegUInt32(packet, ModelRunnerReg.FormatVersion, this.formatVersion)
            this.handleRegBool(packet, ModelRunnerReg.Parallel, false)
            this.handleRegBuffer(packet, ModelRunnerReg.Outputs, this.outputs)
            this.autoInvokeSamples = this.handleRegValue(packet, ModelRunnerReg.AutoInvokeEvery, "u16", this.autoInvokeSamples)

            let arr: number[]
            switch (packet.serviceCommand) {
                case ModelRunnerCmd.SetModel:
                    control.runInBackground(() => this.readModel(packet))
                    break
                case ModelRunnerReg.OutputShape | CMD_GET_REG:
                    arr = this.outputShape
                case ModelRunnerReg.InputShape | CMD_GET_REG:
                    arr = arr || this.inputShape
                    this.sendReport(JDPacket.from(packet.serviceCommand, ml.packArray(arr, NumberFormat.UInt16LE)))
                    break;
                case ModelRunnerReg.LastError | CMD_GET_REG:
                    this.sendReport(JDPacket.from(packet.serviceCommand, Buffer.fromUTF8(this.lastError || "")))
                    break
                default:
                    break;
            }
        }
    }
}