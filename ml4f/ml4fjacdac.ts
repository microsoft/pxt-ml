namespace jacdac {
    export class ML4FServer extends MLServer {
        model: ml4f.Model

        constructor(agg: SensorAggregatorServer) {
            super("ml4f", ModelRunnerModelFormat.ML4F, agg);
        }

        protected invokeModel() {
            try {
                this.outputs = this.model.invoke(this.agg.samplesBuffer)
            } catch (e) {
                this.catchHandler(e)
            }
        }

        protected eraseModel() {
            this.model = null
            binstore.erase()
        }

        protected loadModelImpl() {
            try {
                this.model = new ml4f.Model(this.modelBuffer)
                this.model.test()
            } catch (e) {
                this.catchHandler(e)
            }
        }

        get arenaBytes() {
            if (!this.model)
                return 0
            return this.model.arenaSize
        }

        get inputShape(): number[] {
            if (!this.model)
                return null
            return this.model.inputShape
        }

        get outputShape(): number[] {
            if (!this.model)
                return null
            return this.model.outputShape
        }
    }

    //% whenUsed
    export const ml4fHost = new ML4FServer(sensorAggregatorServer)
}