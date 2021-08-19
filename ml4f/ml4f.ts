namespace ml4f {
    //% shim=ml4f::_invokeModel
    declare function _invoke(model: Buffer, arena: Buffer): void;

    const eps = 0.00002
    function isNear(a: number, b: number) {
        const diff = Math.abs(a - b)
        if (diff < eps)
            return true
        if (diff / (Math.abs(a) + Math.abs(b)) < eps)
            return true
        return false
    }

    export class Model {
        static instance: Model

        constructor(public model: Buffer) {
            const [
                magic,
                _magic1,
                _startOffset,
                objectSize,
                _weightsOffset,
                _testInput, // 5
                _testOutput, // 6
                _arenaSize, // 7
                _inputOffset, // 8
                inputType, // 9
                _outputOffset, // 10
                outputType,
                _padding // times4
            ] = model.unpack("16I")

            if (magic != 0x30470f62)
                throw "Bad magic"
            if (objectSize > model.length)
                throw "Buffer too small"
            if (inputType != 1 || outputType != 1)
                throw "Only f32 i/o supported"
            Model.instance = this
        }

        private header(off: number) {
            return this.model.getNumber(NumberFormat.UInt32LE, off << 2)
        }

        private shape(off: number) {
            const res: number[] = []
            while (true) {
                const v = this.header(off++)
                if (!v)
                    return res
                res.push(v)
            }
        }

        get inputShape() { return this.shape(16) }
        get outputShape() {
            return this.shape(16 + this.inputShape.length + 1)
        }

        get arenaSize() { return this.header(7) }

        test() {
            const testInp = this.header(5)
            const testOutp = this.header(6)
            if (testInp == 0) {
                console.log("no tests defined")
                return // no tests
            }
            const res = this.invoke(this.model.slice(testInp, ml.shapeSize(this.inputShape)))
            const outsz = ml.shapeSize(this.outputShape)
            console.log(`insz: ${this.inputShape.join(",")} outsz: ${this.outputShape.join(",")}`)
            let numfail = 0
            for (let off = 0; off < outsz; off += 4) {
                const act = res.getNumber(NumberFormat.Float32LE, off)
                const exp = this.model.getNumber(NumberFormat.Float32LE, testOutp + off)
                if (!isNear(act, exp)) {
                    numfail++
                    console.log(`test err @${off >> 2}: ${act} vs ${exp}`)
                    if (numfail > 10)
                        break
                }
            }
            if (numfail)
                throw "Model test failed"
            console.log("test passed")
        }

        invoke(input: Buffer) {
            if (input.length != ml.shapeSize(this.inputShape))
                throw "Bad input size"
            const arena = Buffer.create(this.arenaSize)
            const inpOff = this.header(8)
            const outpOff = this.header(10)
            arena.write(inpOff, input)
            _invoke(this.model, arena)
            return arena.slice(outpOff, ml.shapeSize(this.outputShape))
        }
    }
}

namespace ml {
    // The ml namespace cannot be empty, otherwise our "Import Model" button won't show up.

    //% block
    export function selfTest() {
        ml4f.Model.instance.test()
    }
}
