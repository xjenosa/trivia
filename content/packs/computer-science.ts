import type { Pack } from "../types";

// Computer science, for CS students in any year. Assume they code.
//
// STYLE (test/pack.test.ts enforces the measurable parts):
// - One short line per question, at most 90 characters, readable on a projector.
// - Four short answers, at most 18 characters each: they are printed on the platforms.
// - One silly distractor in most questions, never one that could be argued right.
// - Every fact verified, and none that goes stale (no prices, no credit amounts).
// - The correct index is spread evenly across the four platforms, in every tier.
// - Nothing copied from Bean Bash.
export const computerScience: Pack = {
  id: "computer-science",
  title: "Computer Science",
  questions: [
    // ---- easy
    { id: "cs-e01", difficulty: 1, text: "Which one is last in, first out?", answers: ["Queue", "Stack", "Hash map", "My inbox"], correct: 1 },
    { id: "cs-e02", difficulty: 1, text: "What does HTTP status 404 mean?", answers: ["Not found", "Server on fire", "Forbidden", "OK"], correct: 0 },
    { id: "cs-e03", difficulty: 1, text: "Which Git command records staged changes as a new snapshot?", answers: ["git save", "git stash", "git commit", "git yeet"], correct: 2 },
    { id: "cs-e04", difficulty: 1, text: "How many bits are in a byte?", answers: ["4", "8", "16", "Depends on mood"], correct: 1 },
    { id: "cs-e05", difficulty: 1, text: "In C, Java and Python, what is the index of an array's first element?", answers: ["1", "-1", "42", "0"], correct: 3 },
    { id: "cs-e06", difficulty: 1, text: "Which language is used to style web pages?", answers: ["HTML", "SQL", "CSS", "Comic Sans"], correct: 2 },
    { id: "cs-e07", difficulty: 1, text: "What is binary 1010 in decimal?", answers: ["10", "12", "5", "1,010"], correct: 0 },
    { id: "cs-e08", difficulty: 1, text: "Who is often called the first computer programmer?", answers: ["Ada Lovelace", "Alan Turing", "Bill Gates", "Clippy"], correct: 0 },
    { id: "cs-e09", difficulty: 1, text: "In rubber duck debugging, who do you explain your code to?", answers: ["Your manager", "A rubber duck", "The compiler", "Stack Overflow"], correct: 1 },
    { id: "cs-e10", difficulty: 1, text: "Which character starts a comment in Python?", answers: ["//", "--", "#", "pls ignore"], correct: 2 },
    { id: "cs-e11", difficulty: 1, text: "What does the GitHub Student Developer Pack cost a verified student?", answers: ["Nothing", "$5 a month", "$60 a year", "One kidney"], correct: 0 },
    { id: "cs-e12", difficulty: 1, text: "What does the S in HTTPS stand for?", answers: ["Server", "Simple", "Slow", "Secure"], correct: 3 },
    { id: "cs-e13", difficulty: 1, text: "Which Git command downloads a repository for the first time?", answers: ["git pull", "git fetch", "git gimme", "git clone"], correct: 3 },
    { id: "cs-e14", difficulty: 1, text: "What is 7 % 3 in C, Java and Python?", answers: ["2", "1", "0", "2.33"], correct: 1 },
    { id: "cs-e15", difficulty: 1, text: "What does a compiler do?", answers: ["Runs antivirus", "Hosts websites", "Judges you", "Translates code"], correct: 3 },
    { id: "cs-e16", difficulty: 1, text: "In Boolean logic, what is true AND false?", answers: ["true", "false", "null", "maybe"], correct: 1 },
    { id: "cs-e17", difficulty: 1, text: "What does the www in a web address stand for?", answers: ["Wild Wild West", "Wide World Web", "World Wide Web", "Why Why Why"], correct: 2 },
    { id: "cs-e18", difficulty: 1, text: "Which of these is a version control system?", answers: ["Gif", "Gym", "Git", "Gin"], correct: 2 },
    { id: "cs-e19", difficulty: 1, text: "Which number system uses only the digits 0 and 1?", answers: ["Decimal", "Hexadecimal", "Roman numerals", "Binary"], correct: 3 },
    { id: "cs-e20", difficulty: 1, text: "What insect was taped into a Harvard computer's logbook in 1947?", answers: ["A moth", "A bee", "A cockroach", "A ladybug"], correct: 0 },

    // ---- medium
    { id: "cs-m01", difficulty: 2, text: "What is the time complexity of binary search on a sorted array?", answers: ["O(1)", "O(n)", "O(log n)", "O(no)"], correct: 2 },
    { id: "cs-m02", difficulty: 2, text: "Which HTTP status code means \"I'm a teapot\"?", answers: ["418", "404", "451", "200"], correct: 0 },
    { id: "cs-m03", difficulty: 2, text: "Which port does HTTPS use by default?", answers: ["80", "22", "8080", "443"], correct: 3 },
    { id: "cs-m04", difficulty: 2, text: "In SQL, which clause filters rows before they are grouped?", answers: ["HAVING", "WHERE", "ORDER BY", "PLEASE"], correct: 1 },
    { id: "cs-m05", difficulty: 2, text: "What do you type to quit Vim without saving?", answers: [":wq", "exit()", ":q!", "Unplug the PC"], correct: 2 },
    { id: "cs-m06", difficulty: 2, text: "Which company created the Java programming language?", answers: ["Oracle", "Sun Microsystems", "Microsoft", "Starbucks"], correct: 1 },
    { id: "cs-m07", difficulty: 2, text: "Python's style guide, PEP 8, says to indent with what?", answers: ["Tabs", "Both, mixed", "Vibes", "Spaces"], correct: 3 },
    { id: "cs-m08", difficulty: 2, text: "What does DNS translate a domain name into?", answers: ["An IP address", "A MAC address", "A port number", "A zip code"], correct: 0 },
    { id: "cs-m09", difficulty: 2, text: "Which HTTP method is defined as safe, meaning it only reads data?", answers: ["POST", "DELETE", "GET", "YEET"], correct: 2 },
    { id: "cs-m10", difficulty: 2, text: "Which SQL keyword removes duplicate rows from a query's results?", answers: ["SINGLE", "DISTINCT", "DEDUPE", "NO REPEATS"], correct: 1 },
    { id: "cs-m11", difficulty: 2, text: "On average, how long does looking up a key in a hash table take?", answers: ["O(1)", "O(log n)", "O(n)", "O(my)"], correct: 0 },
    { id: "cs-m12", difficulty: 2, text: "Which Git command shows who last changed each line of a file?", answers: ["git shame", "git who", "git snitch", "git blame"], correct: 3 },
    { id: "cs-m13", difficulty: 2, text: "In rm -rf, what does the r stand for?", answers: ["recursive", "remove", "root", "regret"], correct: 0 },
    { id: "cs-m14", difficulty: 2, text: "Which data structure does breadth-first search use?", answers: ["Stack", "Queue", "Heap", "Spreadsheet"], correct: 1 },
    { id: "cs-m15", difficulty: 2, text: "What is the bug called when a loop runs one time too many or too few?", answers: ["Segfault", "Race condition", "Skill issue", "Off-by-one error"], correct: 3 },
    { id: "cs-m16", difficulty: 2, text: "In Python, what does len('hello') return?", answers: ["4", "6", "5", "'hello'"], correct: 2 },
    { id: "cs-m17", difficulty: 2, text: "Which language did Brendan Eich create in about ten days in 1995?", answers: ["Java", "Python", "JavaScript", "COBOL"], correct: 2 },
    { id: "cs-m18", difficulty: 2, text: "Unix time counts the seconds since the start of which year?", answers: ["1970", "1900", "2000", "Last year"], correct: 0 },
    { id: "cs-m19", difficulty: 2, text: "Where do a function's local variables usually live in memory?", answers: ["The heap", "The stack", "The cache", "The cloud"], correct: 1 },
    { id: "cs-m20", difficulty: 2, text: "Which tool got popular by promising an end to \"it works on my machine\"?", answers: ["Excel", "Notepad", "A bigger machine", "Docker"], correct: 3 },

    // ---- hard
    { id: "cs-h01", difficulty: 3, text: "On what date does signed 32-bit Unix time overflow?", answers: ["Jan 19, 2038", "Dec 31, 1999", "Jan 1, 2100", "Next Tuesday"], correct: 0 },
    { id: "cs-h02", difficulty: 3, text: "Which of these sorts runs in O(n log n) time even in the worst case?", answers: ["Quicksort", "Merge sort", "Bubble sort", "Bogosort"], correct: 1 },
    { id: "cs-h03", difficulty: 3, text: "What does the A in ACID stand for?", answers: ["Availability", "Accuracy", "Anxiety", "Atomicity"], correct: 3 },
    { id: "cs-h04", difficulty: 3, text: "Which problem did Alan Turing prove undecidable in 1936?", answers: ["P versus NP", "Sorting", "Halting problem", "Centering a div"], correct: 2 },
    { id: "cs-h05", difficulty: 3, text: "Two threads each wait on a lock the other holds. What is that called?", answers: ["Deadlock", "Race condition", "Starvation", "A staring contest"], correct: 0 },
    { id: "cs-h06", difficulty: 3, text: "Which algorithm finds shortest paths in a graph with non-negative weights?", answers: ["Kruskal's", "Binary search", "Dijkstra's", "Trial and error"], correct: 2 },
    { id: "cs-h07", difficulty: 3, text: "Which normal form removes transitive dependencies?", answers: ["1NF", "2NF", "3NF", "WTF"], correct: 2 },
    { id: "cs-h08", difficulty: 3, text: "What caused the Y2K bug?", answers: ["Two-digit years", "Leap seconds", "A solar flare", "Clippy"], correct: 0 },
    { id: "cs-h09", difficulty: 3, text: "What is it called when a program's result depends on the timing of its threads?", answers: ["Deadlock", "Race condition", "Livelock", "Monday"], correct: 1 },
    { id: "cs-h10", difficulty: 3, text: "How does TCP open a connection?", answers: ["A DNS lookup", "A UDP packet", "A firm handshake", "3-way handshake"], correct: 3 },
    { id: "cs-h11", difficulty: 3, text: "Which HTTP status code means \"Too Many Requests\"?", answers: ["403", "418", "429", "503"], correct: 2 },
    { id: "cs-h12", difficulty: 3, text: "What is the best possible worst-case time for a comparison-based sort?", answers: ["O(n)", "O(n log n)", "O(n²)", "O(1) with luck"], correct: 1 },
    { id: "cs-h13", difficulty: 3, text: "Which Linux signal can a process never catch or ignore?", answers: ["SIGTERM", "SIGINT", "SIGH", "SIGKILL"], correct: 3 },
    { id: "cs-h14", difficulty: 3, text: "Which language did Dennis Ritchie create at Bell Labs?", answers: ["B", "C", "Pascal", "Klingon"], correct: 1 },
    { id: "cs-h15", difficulty: 3, text: "In a Git merge conflict, which marker opens your side of the change?", answers: ["<<<<<<<", "#######", "!!!!!!!", "AAAAAAA"], correct: 0 },
    { id: "cs-h16", difficulty: 3, text: "Which language is purely functional and lazy by default?", answers: ["Java", "Go", "Excel", "Haskell"], correct: 3 },
    { id: "cs-h17", difficulty: 3, text: "Which structure finds its smallest item in O(1) and inserts in O(log n)?", answers: ["Hash table", "Min-heap", "Linked list", "Junk drawer"], correct: 1 },
    { id: "cs-h18", difficulty: 3, text: "Which pioneer wrote one of the first compilers and helped shape COBOL?", answers: ["Grace Hopper", "Ada Lovelace", "Margaret Hamilton", "Siri"], correct: 0 },
    { id: "cs-h19", difficulty: 3, text: "What gives each process its own private address space?", answers: ["The heap", "A mutex", "Virtual memory", "Good manners"], correct: 2 },
    { id: "cs-h20", difficulty: 3, text: "In JavaScript, what does typeof null return?", answers: ["\"null\"", "\"undefined\"", "\"nothing\"", "\"object\""], correct: 3 },
  ],
};
