// Unique id generator. Avoids external dependencies by combining a timestamp
// with a counter and a small random suffix so ids stay unique even when many
// are created within the same millisecond.
let counter = 0;
/** Generate a reasonably unique id with the given prefix. */
export function makeId(prefix) {
    counter = (counter + 1) % 1000000;
    const time = Date.now().toString(36);
    const rand = Math.floor(Math.random() * 0x10000).toString(36);
    return `${prefix}_${time}${counter.toString(36)}${rand}`;
}
