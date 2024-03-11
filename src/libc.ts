import ffi from 'ffi-napi';
import ref from 'ref-napi';

const int = ref.types.int;
const voidPtr = ref.refType(ref.types.void);
const size_t = ref.types.size_t;
const key_t = int;
const mode_t = int;

export const libc = ffi.Library(null, {
    shmget: [int, [key_t, size_t, mode_t]],
    shmat: [voidPtr, [int, voidPtr, int]],
    shmdt: [int, [voidPtr]],
    shmctl: [int, [int, int, voidPtr]],
    sem_open: [voidPtr, ['string', int, 'uint32', 'uint32']],
    sem_getvalue: [int, [voidPtr, ref.refType(int)]],
    sem_wait: [int, [voidPtr]],
    sem_post: [int, [voidPtr]],
    sem_close: [int, [voidPtr]],
    sem_unlink: [int, ['string']],
});

export function isErrorVoidPtr(val: Buffer): boolean { return ref.address(val) == 0xffffffff; };