// iris_ask's labels: bb shows "Waiting: <title>" while the picker waits and "Answered: <title>"
// after, and refuses a request whose label is over 80 characters. A title of up to 120 is
// accepted, so a long one is cut at a word to fit.

/** bb's limit on a pending interaction's label. */
export const ASK_LABEL_MAX = 80;

function fit(prefix: string, title: string): string {
  const whole = `${prefix}${title}`;
  if (whole.length <= ASK_LABEL_MAX) return whole;
  const room = title.slice(0, ASK_LABEL_MAX - prefix.length - 1);
  const atWord = room.replace(/\s+\S*$/, "");
  return `${prefix}${(atWord.length >= room.length / 2 ? atWord : room).trimEnd()}…`;
}

export function askLabels(title: string): { pending: string; completed: string } {
  return { pending: fit("Waiting: ", title), completed: fit("Answered: ", title) };
}
