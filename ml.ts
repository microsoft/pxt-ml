namespace ml {
    export function shapeElements(shape: number[]) {
        let res = 1
        for (const s of shape) res *= s
        return res
    }

    export function shapeSize(shape: number[]) {
        return shapeElements(shape) << 2
    }

    export function packArray(arr: number[], fmt: NumberFormat) {
        const sz = Buffer.sizeOfNumberFormat(fmt)
        const res = Buffer.create(arr.length * sz)
        for (let i = 0; i < arr.length; ++i)
            res.setNumber(fmt, i * sz, arr[i])
        return res
    }

    export class Classifier {
        detectionThreshold = 0.7
        samplingInterval = 100
        samplesOverlap = 25
        samplesInWindow = 100
        elementsInSample = 3
        noiseClassNo = -1
        noiseSuppressionTime = 500 // ms

        currentClass: number

        private inputBuffer: Buffer
        private lastNonNoiseClass: number
        private lastNonNoiseTime: number
        private handlers: (() => void)[] = []

        constructor(
            public runModel: (inputs: Buffer) => Buffer,
            public sample: () => number[]
        ) { }

        onEvent(classId: number, handler: () => void) {
            this.handlers[classId] = handler
        }

        stop() {
            this.inputBuffer = null
        }

        private processOutput(output: Buffer) {
            const prevClass = this.currentClass
            const now = control.millis()
            for (let i = 0; i < output.length; i += 4) {
                const v = output.getNumber(NumberFormat.Float32LE, i)
                if (v > this.detectionThreshold) {
                    this.currentClass = i
                    if (this.currentClass != this.noiseClassNo) {
                        this.lastNonNoiseClass = this.currentClass
                        this.lastNonNoiseTime = now
                    } else if (this.noiseClassNo >= 0 && now - this.lastNonNoiseTime < this.noiseSuppressionTime) {
                        this.currentClass = this.lastNonNoiseClass
                    }
                    if (prevClass != this.currentClass) {
                        const f = this.handlers[this.currentClass]
                        if (f)
                            f()
                    }
                    return
                }
            }
        }

        private sampleLoop(input: Buffer) {
            const numshift = this.elementsInSample * 4 * this.samplesOverlap
            let nexttime = control.millis() + this.samplingInterval
            let inpptr = 0
            this.currentClass = -1
            while (this.inputBuffer == input) {
                const now = control.millis()
                const pauselen = nexttime - now
                nexttime += this.samplingInterval
                pause(Math.max(0, pauselen))
                if (this.inputBuffer != input) break

                const nums = this.sample()
                if (nums.length != this.elementsInSample)
                    throw "invalid sample()"
                for (const num of nums) {
                    input.setNumber(NumberFormat.Float32LE, inpptr, num)
                    inpptr += 4
                }
                if (inpptr >= input.length) {
                    this.processOutput(this.runModel(input))
                    input.shift(numshift)
                    inpptr -= numshift
                }
            }
        }

        start() {
            if (this.inputBuffer)
                return
            const input = Buffer.create(this.elementsInSample * this.samplesInWindow)
            this.inputBuffer = input
            control.runInBackground(() => this.sampleLoop(input))
        }
    }
}
