/** How the next note should arrive on screen. Read once per note change, then reset. */
export type Entrance = "dawn" | "focus" | "plain" | "none";

let next: Entrance = "plain";

export const setEntrance = (e: Entrance) => {
  next = e;
};
export const peekEntrance = () => next;
export const resetEntrance = () => {
  next = "focus";
};
