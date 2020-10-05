// Auto-generated. Do not edit.
declare namespace binstore {

    /**
     * Returns the maximum allowed size of binstore buffers.
     */
    //% shim=binstore::totalSize
    function totalSize(): uint32;

    /**
     * Returns the address of data of the first buffer (or 0 if not available).
     */
    //% shim=binstore::dataAddress
    function dataAddress(): uint32;

    /**
     * Clear storage.
     */
    //% shim=binstore::erase
    function erase(): int32;

    /**
     * Add a buffer of given size to binstore.
     */
    //% shim=binstore::addBuffer
    function addBuffer(size: uint32): Buffer;

    /**
     * Write bytes in a binstore buffer.
     */
    //% shim=binstore::write
    function write(dst: Buffer, dstOffset: int32, src: Buffer): void;
}

// Auto-generated. Do not edit. Really.
