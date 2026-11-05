// A scannerless recursive-descent parser for Iris markup: JSX-style tags with
// {expressions}, and a safe JavaScript expression subset inside the braces.
//
// Streaming: the agent's reply arrives in chunks, so the parser builds the tree
// as it goes. An element joins its parent as soon as its opening tag is
// complete, and the input ending early is reported as `incomplete`, never as an
// error. The renderer draws whatever arrived and keeps growing it.

import type { Attr, ElementNode, Expr, Node, ObjProp, Param, ParseIssue, ParseResult, SpreadExpr, Stmt } from "./ast";

import { RAW_TAGS } from "./catalog";

/** Elements whose content is read verbatim (Mermaid, code, patches, logs, plus Markdown and Math). */
export const RAW_TEXT_ELEMENTS = new Set([...RAW_TAGS, "Markdown", "Math", "Html"]);

const MAX_DEPTH = 120;

class Incomplete extends Error {}
class SyntaxIssue extends Error {
  constructor(
    message: string,
    readonly start: number,
    readonly end: number,
  ) {
    super(message);
  }
}

const isIdStart = (c: string) => /[A-Za-z_$]/.test(c);
const isIdPart = (c: string) => /[\w$]/.test(c);
const isTagStart = (c: string) => /[A-Za-z_]/.test(c);
const isTagPart = (c: string) => /[\w.-]/.test(c);
const isAttrPart = (c: string) => /[\w:.-]/.test(c);

export function parse(src: string): ParseResult {
  const p = new Parser(src);
  const nodes: Node[] = [];
  let error: ParseIssue | null = null;
  let incomplete = false;
  try {
    p.children(nodes, null);
  } catch (cause) {
    if (cause instanceof Incomplete) incomplete = true;
    else if (cause instanceof SyntaxIssue) error = p.issue(cause.message, cause.start, cause.end);
    else throw cause;
  }
  if (!incomplete && p.openElements > 0) incomplete = true;
  return { nodes, error, incomplete };
}

/** Parses one expression on its own (used by tools and tests). */
export function parseExpression(src: string): Expr {
  // A trailing newline lets a name or number at the very end count as complete.
  const p = new Parser(`${src}\n`);
  const e = p.expr();
  p.ws();
  if (!p.eof()) throw new Error(`Unexpected "${p.s[p.i]}" at ${p.i}`);
  return e;
}

class Parser {
  i = 0;
  depth = 0;
  openElements = 0;
  constructor(readonly s: string) {}

  issue(message: string, start: number, end: number): ParseIssue {
    const before = this.s.slice(0, start);
    const line = before.split("\n").length;
    const col = start - before.lastIndexOf("\n");
    return { message, start, end, line, col };
  }

  eof() {
    return this.i >= this.s.length;
  }
  peek(n = 0) {
    return this.s[this.i + n] ?? "";
  }
  starts(t: string) {
    return this.s.startsWith(t, this.i);
  }
  need(n = 1) {
    if (this.i + n > this.s.length) throw new Incomplete();
  }
  fail(message: string, start = this.i, end = this.i + 1): never {
    if (this.eof()) throw new Incomplete();
    throw new SyntaxIssue(message, start, end);
  }
  eat(t: string): boolean {
    if (this.starts(t)) {
      this.i += t.length;
      return true;
    }
    // A token cut in half by the stream is incomplete, not wrong.
    if (this.s.length - this.i < t.length && t.startsWith(this.s.slice(this.i))) throw new Incomplete();
    return false;
  }
  expect(t: string, what = `"${t}"`) {
    if (!this.eat(t)) this.fail(`Expected ${what}`);
  }
  /** Skips whitespace and comments inside expressions and tags. */
  ws() {
    for (;;) {
      while (!this.eof() && /\s/.test(this.peek())) this.i++;
      if (this.starts("//")) {
        const nl = this.s.indexOf("\n", this.i);
        this.i = nl < 0 ? this.s.length : nl + 1;
        continue;
      }
      if (this.starts("/*")) {
        const end = this.s.indexOf("*/", this.i + 2);
        if (end < 0) throw new Incomplete();
        this.i = end + 2;
        continue;
      }
      return;
    }
  }
  enter() {
    if (++this.depth > MAX_DEPTH) this.fail("Nested too deeply");
  }
  leave() {
    this.depth--;
  }

  // ---------- markup ----------

  /** Reads children into `out` until the closing tag of `parent` (or EOF at the top level). */
  children(out: Node[], parent: ElementNode | null) {
    for (;;) {
      if (this.eof()) {
        if (parent) throw new Incomplete();
        return;
      }
      const start = this.i;
      if (this.starts("<!--")) {
        const end = this.s.indexOf("-->", this.i + 4);
        if (end < 0) throw new Incomplete();
        this.i = end + 3;
        continue;
      }
      if (this.peek() === "<") {
        if (this.peek(1) === "/") {
          if (!parent) this.fail("This closing tag has no matching opening tag", start, this.lineEnd(start));
          this.closeTag(parent);
          return;
        }
        if (this.peek(1) === "" ) throw new Incomplete();
        if (isTagStart(this.peek(1)) || this.peek(1) === ">") {
          this.element(out);
          continue;
        }
        // A lone "<" in prose (e.g. "a < b") is text.
      }
      if (this.peek() === "{") {
        this.exprContainer(out);
        continue;
      }
      this.text(out, parent !== null);
    }
  }

  lineEnd(from: number) {
    const nl = this.s.indexOf("\n", from);
    return nl < 0 ? this.s.length : nl;
  }

  text(out: Node[], nested: boolean) {
    const start = this.i;
    this.i++; // children() only sends us here when the first character is text
    while (!this.eof()) {
      const c = this.peek();
      if (c === "{") break;
      if (c === "<" && (isTagStart(this.peek(1)) || this.peek(1) === "/" || this.peek(1) === ">" || this.peek(1) === "!" || this.peek(1) === "")) break;
      this.i++;
    }
    let value = this.s.slice(start, this.i);
    if (this.eof() && nested) {
      // Hold back a half-streamed word so prose does not flicker mid-word.
      let cut = value.length;
      while (cut > 0 && !/\s/.test(value[cut - 1])) cut--;
      if (cut > 0 && cut < value.length) value = value.slice(0, cut);
    }
    if (value.length > 0) out.push({ kind: "text", value, start, end: start + value.length });
  }

  exprContainer(out: Node[]) {
    const start = this.i;
    this.i++; // {
    this.ws();
    if (this.eat("}")) return; // {} or {/* comment */}
    const expr = this.expr();
    this.ws();
    this.expect("}", 'a closing "}"');
    out.push({ kind: "expr", expr, start, end: this.i });
  }

  /** Parses `<Name ...>children</Name>` and appends it to `out` once its opening tag is complete. */
  element(out: Node[]): ElementNode {
    const start = this.i;
    this.enter();
    this.i++; // <
    let name = "";
    if (this.peek() !== ">") {
      while (!this.eof() && isTagPart(this.peek())) name += this.s[this.i++];
      if (this.eof()) throw new Incomplete();
    }
    const attrs: Attr[] = [];
    let selfClosing = false;
    for (;;) {
      this.ws();
      this.need();
      if (this.eat("/>")) {
        selfClosing = true;
        break;
      }
      if (this.eat(">")) break;
      if (!isAttrPart(this.peek()) && this.peek() !== "{") this.fail(`Unexpected "${this.peek()}" in <${name}>`);
      attrs.push(this.attr(name));
    }
    const el: ElementNode = { kind: "element", name, attrs, children: [], closed: selfClosing, selfClosing, start, end: this.i };
    out.push(el);
    if (!selfClosing) {
      this.openElements++;
      if (RAW_TEXT_ELEMENTS.has(name)) this.rawChildren(el);
      else this.children(el.children, el);
      this.openElements--;
      el.closed = true;
    }
    el.end = this.i;
    this.leave();
    return el;
  }

  attr(tag: string): Attr {
    const start = this.i;
    if (this.peek() === "{") {
      // {...spread} attributes.
      this.i++;
      this.ws();
      this.expect("...", '"..." (only spread attributes go in braces)');
      const arg = this.expr();
      this.ws();
      this.expect("}");
      return { name: "...", value: arg, start, end: this.i };
    }
    let name = "";
    while (!this.eof() && isAttrPart(this.peek())) name += this.s[this.i++];
    this.ws();
    this.need();
    if (!this.eat("=")) return { name, value: null, start, end: this.i };
    this.ws();
    this.need();
    const q = this.peek();
    if (q === '"' || q === "'") {
      const vStart = this.i;
      this.i++;
      const close = this.s.indexOf(q, this.i);
      if (close < 0) throw new Incomplete();
      const v = this.s.slice(this.i, close);
      this.i = close + 1;
      return { name, value: { t: "lit", v, start: vStart, end: this.i }, start, end: this.i };
    }
    if (q === "{") {
      this.i++;
      this.ws();
      const value = this.expr();
      this.ws();
      this.expect("}", `a closing "}" for ${name}`);
      return { name, value, start, end: this.i };
    }
    if (q === "<") {
      const el = this.element([]);
      return { name, value: { t: "jsx", el, start: el.start, end: el.end }, start, end: this.i };
    }
    return this.fail(`The value of ${name} in <${tag}> needs quotes or braces, like ${name}="..." or ${name}={...}`);
  }

  rawChildren(el: ElementNode) {
    const close = `</${el.name}>`;
    const end = this.s.indexOf(close, this.i);
    const start = this.i;
    if (end < 0) {
      // Still streaming: show what arrived so far.
      const value = this.s.slice(this.i);
      if (value) el.children.push({ kind: "text", value, start, end: this.s.length });
      this.i = this.s.length;
      throw new Incomplete();
    }
    const value = this.s.slice(this.i, end);
    if (value) el.children.push({ kind: "text", value, start, end });
    this.i = end + close.length;
  }

  closeTag(el: ElementNode) {
    const start = this.i;
    this.i += 2; // </
    let name = "";
    while (!this.eof() && isTagPart(this.peek())) name += this.s[this.i++];
    this.ws();
    this.need();
    this.expect(">");
    if (name !== el.name) {
      const want = el.name ? `</${el.name}>` : "</>";
      // The tag is complete, so this is a real mistake even at the end of the input.
      throw new SyntaxIssue(`Expected ${want} to close <${el.name}> but found </${name}>`, start, this.i);
    }
  }

  // ---------- expressions ----------

  expr(): Expr {
    const first = this.assign();
    this.ws();
    if (this.peek() !== ",") return first;
    // Sequence expressions only make sense inside parentheses; keep them simple.
    return first;
  }

  assign(): Expr {
    this.enter();
    try {
      this.ws();
      const start = this.i;
      const arrow = this.tryArrow();
      if (arrow) return arrow;
      const left = this.conditional();
      this.ws();
      for (const op of ["??=", "||=", "&&=", "+=", "-=", "*=", "/="] as const) {
        if (this.starts(op)) {
          this.i += op.length;
          const value = this.assign();
          return { t: "assign", op, target: this.assignable(left), value, start, end: this.i };
        }
      }
      if (this.peek() === "=" && this.peek(1) !== "=" && this.peek(1) !== ">") {
        this.i++;
        const value = this.assign();
        return { t: "assign", op: "=", target: this.assignable(left), value, start, end: this.i };
      }
      return left;
    } finally {
      this.leave();
    }
  }

  assignable(e: Expr): Expr {
    if (e.t === "id" || e.t === "mem") return e;
    return this.fail("Only a state name or one of its fields can be assigned", e.start, e.end);
  }

  tryArrow(): Expr | null {
    const start = this.i;
    if (isIdStart(this.peek())) {
      const save = this.i;
      const name = this.ident();
      this.ws();
      if (this.starts("=>")) {
        this.i += 2;
        return this.arrowBody([{ kind: "name", name }], start);
      }
      this.i = save;
      return null;
    }
    if (this.peek() !== "(") return null;
    // Scan to the matching ")" and look for "=>" after it.
    let depth = 0;
    let j = this.i;
    let inStr: string | null = null;
    for (; j < this.s.length; j++) {
      const c = this.s[j];
      if (inStr) {
        if (c === "\\") j++;
        else if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") inStr = c;
      else if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (j >= this.s.length) {
      // The parenthesis never closed yet; decide later.
      return null;
    }
    let k = j + 1;
    while (k < this.s.length && /\s/.test(this.s[k])) k++;
    if (!this.s.startsWith("=>", k)) {
      if (k >= this.s.length - 1 && this.s.slice(k) === "=") throw new Incomplete();
      return null;
    }
    this.i++; // (
    const params: Param[] = [];
    this.ws();
    while (!this.eat(")")) {
      params.push(this.param());
      this.ws();
      if (!this.eat(",")) {
        this.ws();
        this.expect(")");
        break;
      }
      this.ws();
    }
    this.ws();
    this.expect("=>");
    return this.arrowBody(params, start);
  }

  param(): Param {
    this.ws();
    if (this.eat("{")) {
      const names: { key: string; local: string; def?: Expr }[] = [];
      this.ws();
      while (!this.eat("}")) {
        const key = this.ident();
        this.ws();
        let local = key;
        if (this.eat(":")) {
          this.ws();
          local = this.ident();
          this.ws();
        }
        let def: Expr | undefined;
        if (this.eat("=")) def = this.assign();
        names.push({ key, local, def });
        this.ws();
        this.eat(",");
        this.ws();
      }
      return { kind: "obj", names };
    }
    if (this.eat("[")) {
      const names: (string | null)[] = [];
      this.ws();
      while (!this.eat("]")) {
        if (this.peek() === ",") names.push(null);
        else names.push(this.ident());
        this.ws();
        this.eat(",");
        this.ws();
      }
      return { kind: "arr", names };
    }
    const name = this.ident();
    this.ws();
    let def: Expr | undefined;
    if (this.eat("=")) def = this.assign();
    return { kind: "name", name, def };
  }

  arrowBody(params: Param[], start: number): Expr {
    this.ws();
    this.need();
    if (this.peek() === "{") {
      this.i++;
      const body = this.block();
      return { t: "arrow", params, body, start, end: this.i };
    }
    const body = this.assign();
    return { t: "arrow", params, body, start, end: this.i };
  }

  /** Statements until the closing "}". */
  block(): Stmt[] {
    const out: Stmt[] = [];
    for (;;) {
      this.ws();
      this.need();
      if (this.eat("}")) return out;
      if (this.eat(";")) continue;
      out.push(this.stmt());
    }
  }

  stmt(): Stmt {
    this.ws();
    const save = this.i;
    if (isIdStart(this.peek())) {
      const word = this.ident();
      if (word === "return") {
        this.ws();
        if (this.peek() === ";" || this.peek() === "}") return { s: "return", expr: null };
        return { s: "return", expr: this.expr() };
      }
      if (word === "const" || word === "let") {
        this.ws();
        const name = this.ident();
        this.ws();
        this.expect("=");
        return { s: "const", name, value: this.assign() };
      }
      if (word === "if") {
        this.ws();
        this.expect("(");
        const test = this.expr();
        this.ws();
        this.expect(")");
        const then = this.branch();
        this.ws();
        let otherwise: Stmt[] | null = null;
        const save2 = this.i;
        if (isIdStart(this.peek()) && this.ident() === "else") otherwise = this.branch();
        else this.i = save2;
        return { s: "if", test, then, else: otherwise };
      }
      this.i = save;
    }
    return { s: "expr", expr: this.expr() };
  }

  branch(): Stmt[] {
    this.ws();
    if (this.eat("{")) return this.block();
    return [this.stmt()];
  }

  conditional(): Expr {
    const start = this.i;
    const test = this.binary(0);
    this.ws();
    if (this.peek() === "?" && this.peek(1) !== "?" && this.peek(1) !== ".") {
      this.i++;
      const then = this.assign();
      this.ws();
      this.expect(":", 'the ":" of a ? : expression');
      const otherwise = this.assign();
      return { t: "cond", test, then, else: otherwise, start, end: this.i };
    }
    return test;
  }

  static readonly LEVELS: string[][] = [
    ["??"],
    ["||"],
    ["&&"],
    ["===", "!==", "==", "!="],
    ["<=", ">=", "<", ">"],
    ["+", "-"],
    ["*", "/", "%"],
  ];

  binary(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.exponent();
    const start = this.i;
    let left = this.binary(level + 1);
    for (;;) {
      this.ws();
      const op = Parser.LEVELS[level].find((o) => this.starts(o) && !this.isLongerOp(o));
      if (!op) return left;
      this.i += op.length;
      const right = this.binary(level + 1);
      left =
        op === "&&" || op === "||" || op === "??"
          ? { t: "log", op, l: left, r: right, start, end: this.i }
          : { t: "bin", op, l: left, r: right, start, end: this.i };
    }
  }

  /** Keeps "=" from "==", "<" from "<=", and "=>" or "+=" from being read as binary operators. */
  isLongerOp(op: string): boolean {
    const next = this.s[this.i + op.length] ?? "";
    if (op === "<" || op === ">") return next === "=" || (op === "<" && (isTagStart(next) || next === "/"));
    if (op === "+" || op === "-") return next === "=" || next === op;
    if (op === "*" || op === "/" || op === "%") return next === "=" || (op === "*" && next === "*");
    if (op === "==" || op === "!=") return next === "=";
    if (op === "||" || op === "&&" || op === "??") return next === "=";
    return false;
  }

  exponent(): Expr {
    const start = this.i;
    const base = this.unary();
    this.ws();
    if (this.starts("**")) {
      this.i += 2;
      const exp = this.exponent();
      return { t: "bin", op: "**", l: base, r: exp, start, end: this.i };
    }
    return base;
  }

  unary(): Expr {
    this.ws();
    const start = this.i;
    if (this.starts("++") || this.starts("--")) {
      const op = this.s.slice(this.i, this.i + 2) as "++" | "--";
      this.i += 2;
      const target = this.unary();
      return { t: "update", op, prefix: true, target: this.assignable(target), start, end: this.i };
    }
    const c = this.peek();
    if (c === "!" || c === "-" || c === "+") {
      this.i++;
      const arg = this.unary();
      return { t: "un", op: c, arg, start, end: this.i };
    }
    if (this.starts("typeof") && !isIdPart(this.peek(6))) {
      this.i += 6;
      const arg = this.unary();
      return { t: "un", op: "typeof", arg, start, end: this.i };
    }
    return this.postfix();
  }

  postfix(): Expr {
    const start = this.i;
    let e = this.primary();
    for (;;) {
      // No whitespace skipping before "(" "[" "." keeps "a\n(b)" sane enough for markup.
      const save = this.i;
      this.ws();
      if (this.starts("?.")) {
        this.i += 2;
        if (this.eat("(")) {
          e = { t: "call", callee: e, args: this.args(")"), optional: true, start, end: this.i };
        } else if (this.eat("[")) {
          const prop = this.expr();
          this.ws();
          this.expect("]");
          e = { t: "mem", obj: e, prop, computed: true, optional: true, start, end: this.i };
        } else {
          const pStart = this.i;
          const name = this.ident();
          e = { t: "mem", obj: e, prop: { t: "lit", v: name, start: pStart, end: this.i }, computed: false, optional: true, start, end: this.i };
        }
        continue;
      }
      const c = this.peek();
      if (c === ".") {
        this.i++;
        this.ws();
        const pStart = this.i;
        const name = this.ident();
        e = { t: "mem", obj: e, prop: { t: "lit", v: name, start: pStart, end: this.i }, computed: false, optional: false, start, end: this.i };
        continue;
      }
      if (c === "[") {
        this.i++;
        const prop = this.expr();
        this.ws();
        this.expect("]");
        e = { t: "mem", obj: e, prop, computed: true, optional: false, start, end: this.i };
        continue;
      }
      if (c === "(") {
        this.i++;
        e = { t: "call", callee: e, args: this.args(")"), optional: false, start, end: this.i };
        continue;
      }
      if ((this.starts("++") || this.starts("--")) && (e.t === "id" || e.t === "mem")) {
        const op = this.s.slice(this.i, this.i + 2) as "++" | "--";
        this.i += 2;
        e = { t: "update", op, prefix: false, target: e, start, end: this.i };
        continue;
      }
      this.i = save;
      return e;
    }
  }

  args(close: string): (Expr | SpreadExpr)[] {
    const out: (Expr | SpreadExpr)[] = [];
    for (;;) {
      this.ws();
      this.need();
      if (this.eat(close)) return out;
      const start = this.i;
      if (this.eat("...")) out.push({ t: "spread", arg: this.assign(), start, end: this.i });
      else out.push(this.assign());
      this.ws();
      this.need();
      if (this.eat(close)) return out;
      this.expect(",", `"," or "${close}"`);
    }
  }

  ident(): string {
    this.need();
    if (!isIdStart(this.peek())) this.fail(`Expected a name but found "${this.peek()}"`);
    let name = "";
    while (!this.eof() && isIdPart(this.peek())) name += this.s[this.i++];
    // A name at the very end of streaming input may be cut short.
    if (this.eof()) throw new Incomplete();
    return name;
  }

  primary(): Expr {
    this.ws();
    this.need();
    const start = this.i;
    const c = this.peek();
    if (c === "(") {
      this.i++;
      const inner = this.expr();
      this.ws();
      this.expect(")");
      return inner;
    }
    if (c === "[") {
      this.i++;
      const items: (Expr | SpreadExpr)[] = [];
      for (;;) {
        this.ws();
        this.need();
        if (this.eat("]")) break;
        const s = this.i;
        if (this.eat("...")) items.push({ t: "spread", arg: this.assign(), start: s, end: this.i });
        else items.push(this.assign());
        this.ws();
        this.need();
        if (this.eat("]")) break;
        this.expect(",", '"," or "]"');
      }
      return { t: "arr", items, start, end: this.i };
    }
    if (c === "{") {
      this.i++;
      return this.object(start);
    }
    if (c === '"' || c === "'") return { t: "lit", v: this.string(c), start, end: this.i };
    if (c === "`") return this.template();
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(this.peek(1)))) return this.number();
    if (c === "<") {
      const el = this.element([]);
      return { t: "jsx", el, start, end: this.i };
    }
    if (isIdStart(c)) {
      const name = this.ident();
      switch (name) {
        case "true":
          return { t: "lit", v: true, start, end: this.i };
        case "false":
          return { t: "lit", v: false, start, end: this.i };
        case "null":
          return { t: "lit", v: null, start, end: this.i };
        case "undefined":
          return { t: "lit", v: undefined, start, end: this.i };
      }
      return { t: "id", name, start, end: this.i };
    }
    return this.fail(`Unexpected "${c}"`);
  }

  object(start: number): Expr {
    const props: ObjProp[] = [];
    for (;;) {
      this.ws();
      this.need();
      if (this.eat("}")) break;
      if (this.eat("...")) {
        props.push({ kind: "spread", arg: this.assign() });
      } else {
        let key: string | Expr;
        let computed = false;
        const q = this.peek();
        if (q === '"' || q === "'") key = this.string(q);
        else if (this.eat("[")) {
          key = this.expr();
          this.ws();
          this.expect("]");
          computed = true;
        } else if (/[0-9]/.test(q)) {
          const n = this.number();
          key = String((n as { v: number }).v);
        } else key = this.ident();
        this.ws();
        this.need();
        if (this.eat(":")) {
          props.push({ kind: "prop", key, computed, value: this.assign() });
        } else if (typeof key === "string" && !computed) {
          props.push({ kind: "prop", key, computed: false, value: { t: "id", name: key, start: this.i, end: this.i } });
        } else this.fail('Expected ":"');
      }
      this.ws();
      this.need();
      if (this.eat("}")) break;
      this.expect(",", '"," or "}"');
    }
    return { t: "obj", props, start, end: this.i };
  }

  string(q: string): string {
    this.i++;
    let out = "";
    for (;;) {
      this.need();
      const c = this.s[this.i++];
      if (c === q) return out;
      if (c === "\\") {
        this.need();
        out += this.escape();
        continue;
      }
      if (c === "\n") this.fail("A string can't span lines; use a template string `...` instead", this.i - 1);
      out += c;
    }
  }

  escape(): string {
    const e = this.s[this.i++];
    switch (e) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "0":
        return "\0";
      case "u": {
        this.need(4);
        const hex = this.s.slice(this.i, this.i + 4);
        this.i += 4;
        return String.fromCharCode(parseInt(hex, 16));
      }
      default:
        return e;
    }
  }

  template(): Expr {
    const start = this.i;
    this.i++; // `
    const quasis: string[] = [];
    const exprs: Expr[] = [];
    let cur = "";
    for (;;) {
      this.need();
      const c = this.s[this.i++];
      if (c === "`") break;
      if (c === "\\") {
        this.need();
        cur += this.escape();
        continue;
      }
      if (c === "$" && this.peek() === "{") {
        this.i++;
        quasis.push(cur);
        cur = "";
        exprs.push(this.expr());
        this.ws();
        this.expect("}");
        continue;
      }
      cur += c;
    }
    quasis.push(cur);
    return { t: "tpl", quasis, exprs, start, end: this.i };
  }

  number(): Expr {
    const start = this.i;
    const m = /^(?:\d[\d_]*)?(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?/.exec(this.s.slice(this.i));
    const text = m?.[0] ?? "";
    if (!text) this.fail("Expected a number");
    this.i += text.length;
    if (this.eof()) throw new Incomplete();
    return { t: "lit", v: Number(text.replace(/_/g, "")), start, end: this.i };
  }
}
