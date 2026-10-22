/* Offline encoding reference only. No device entry point or flashing code.
 * Reproduce with clang --target=arm-none-eabi -mcpu=cortex-m33 -mthumb -c.
 * Each patch below is a four-byte MOVW, preserving registers and APSR flags.
 */
.syntax unified
.cpu cortex-m33
.thumb
.text
.global duration_r1
.thumb_func
duration_r1:
    movw r1, #60000
.global duration_r3
.thumb_func
duration_r3:
    movw r3, #60000

/* Exact control shape at showSuggest + 0xe2 through +0xf0, excluding calls.
 * MOVW must preserve CMP flags across MOV r0,r5 and the following IT NE.
 */
.global conditional_initial
.thumb_func
conditional_initial:
    cmp r0, r6
    movw r1, #60000
    mov r0, r5
    it ne
    movwne r1, #60000
