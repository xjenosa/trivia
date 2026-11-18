export type Difficulty = 1 | 2 | 3; // easy, medium, hard

export interface Question {
  id: string;
  // One short line, readable on a projector: at most 90 characters.
  text: string;
  // Printed on the platforms: at most 18 characters each.
  answers: [string, string, string, string];
  correct: 0 | 1 | 2 | 3;
  difficulty: Difficulty;
}

export interface Pack {
  id: string;
  title: string;
  questions: Question[];
}

export const TEXT_MAX = 90;
export const ANSWER_MAX = 18;
