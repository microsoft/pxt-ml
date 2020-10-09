namespace jd_class {
    export const MODEL_RUNNER = 0x140f9a78
}

namespace jacdac {
    export enum ModelRunnerModelFormat { // uint32_t
        TFLite = 0x334c4654,
        ML4F = 0x30470f62,
        EdgeImpulseCompiled = 0x30564945,
    }

    export enum ModelRunnerCmd {
        /**
         * Argument: model_size bytes uint32_t. Open pipe for streaming in the model. The size of the model has to be declared upfront.
         * The model is streamed over regular pipe data packets.
         * The format supported by this instance of the service is specified in `format` register.
         * When the pipe is closed, the model is written all into flash, and the device running the service may reset.
         */
        SetModel = 0x80,

        /**
         * Argument: outputs pipe (bytes). Open channel that can be used to manually invoke the model. When enough data is sent over the `inputs` pipe, the model is invoked,
         * and results are send over the `outputs` pipe.
         */
        Predict = 0x81,
    }

    export enum ModelRunnerReg {
        /**
         * Read-write uint16_t. When register contains `N > 0`, run the model automatically every time new `N` samples are collected.
         * Model may be run less often if it takes longer to run than `N * sampling_interval`.
         * The `outputs` register will stream its value after each run.
         * This register is not stored in flash.
         */
        AutoInvokeEvery = 0x80,

        /** Read-only bytes. Results of last model invocation as `float32` array. */
        Outputs = 0x101,

        /** Read-only dimension uint16_t. The shape of the input tensor. */
        InputShape = 0x180,

        /** Read-only dimension uint16_t. The shape of the output tensor. */
        OutputShape = 0x181,

        /** Read-only μs uint32_t. The time consumed in last model execution. */
        LastRunTime = 0x182,

        /** Read-only bytes uint32_t. Number of RAM bytes allocated for model execution. */
        AllocatedArenaSize = 0x183,

        /** Read-only bytes uint32_t. The size of the model in bytes. */
        ModelSize = 0x184,

        /** Read-only string (bytes). Textual description of last error when running or loading model (if any). */
        LastError = 0x185,

        /**
         * Constant ModelFormat (uint32_t). The type of ML models supported by this service.
         * `ModelRunner` is flatbuffer `.tflite` file.
         * `ML4F` is compiled machine code model for Cortex-M4F.
         * The format is typically present as first or second little endian word of model file.
         */
        Format = 0x186,

        /** Constant uint32_t. A version number for the format. */
        FormatVersion = 0x187,

        /**
         * Constant bool (uint8_t). If present and true this service can run models independently of other
         * instances of this service on the device.
         */
        Parallel = 0x188,
    }

    export class MLHost extends Host {
        protected autoInvokeSamples = 0
        protected execTime = 0
        protected outputs = Buffer.create(0)
        protected lastError: string
        protected lastRunNumSamples = 0
        protected formatVersion = 0

        constructor(nam: string, protected format: number, protected agg: SensorAggregatorHost) {
            super(nam, jd_class.MODEL_RUNNER);
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
            this.sendReport(JDPacket.packed(packet.service_command, "H", [pipe.port]))
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
            this.handleRegInt(packet, ModelRunnerReg.AllocatedArenaSize, this.arenaBytes)
            this.handleRegInt(packet, ModelRunnerReg.LastRunTime, this.execTime)
            this.handleRegInt(packet, ModelRunnerReg.ModelSize, this.modelSize)
            this.handleRegInt(packet, ModelRunnerReg.Format, this.format)
            this.handleRegInt(packet, ModelRunnerReg.FormatVersion, this.formatVersion)
            this.handleRegBool(packet, ModelRunnerReg.Parallel, false)
            this.handleRegBuffer(packet, ModelRunnerReg.Outputs, this.outputs)
            this.autoInvokeSamples = this.handleRegInt(packet, ModelRunnerReg.AutoInvokeEvery, this.autoInvokeSamples)

            let arr: number[]
            switch (packet.service_command) {
                case ModelRunnerCmd.SetModel:
                    control.runInBackground(() => this.readModel(packet))
                    break
                case ModelRunnerReg.OutputShape | CMD_GET_REG:
                    arr = this.outputShape
                case ModelRunnerReg.InputShape | CMD_GET_REG:
                    arr = arr || this.inputShape
                    this.sendReport(JDPacket.from(packet.service_command, ml.packArray(arr, NumberFormat.UInt16LE)))
                    break;
                case ModelRunnerReg.LastError | CMD_GET_REG:
                    this.sendReport(JDPacket.from(packet.service_command, Buffer.fromUTF8(this.lastError || "")))
                    break
                default:
                    break;
            }
        }
    }
}