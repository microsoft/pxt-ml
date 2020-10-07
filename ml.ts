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
}