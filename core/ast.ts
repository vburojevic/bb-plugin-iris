// The Iris markup AST. One parser reads both the markup (JSX-style tags) and
// the expressions inside {braces}; JSX can also appear inside expressions,
// for example in `{rows.map((r) => <Row>{r.name}</Row>)}`.

export interface Span {
  start: number;
  end: number;
}

export interface Attr extends Span {
  name: string;
  /** null for a bare flag (`<Toggle disabled />`), which means true. */
  value: Expr | null;
}

export interface ElementNode extends Span {
  kind: "element";
  /** Tag name; "" for a fragment `<>...</>`. */
  name: string;
  attrs: Attr[];
  children: Node[];
  /** False while the closing tag has not arrived (streaming, or unclosed). */
  closed: boolean;
  selfClosing: boolean;
}

export interface TextNode extends Span {
  kind: "text";
  value: string;
}

export interface ExprNode extends Span {
  kind: "expr";
  expr: Expr;
}

export type Node = ElementNode | TextNode | ExprNode;

export type Expr =
  | ({ t: "lit"; v: string | number | boolean | null | undefined } & Span)
  | ({ t: "id"; name: string } & Span)
  | ({ t: "arr"; items: (Expr | SpreadExpr)[] } & Span)
  | ({ t: "obj"; props: ObjProp[] } & Span)
  | ({ t: "tpl"; quasis: string[]; exprs: Expr[] } & Span)
  | ({ t: "un"; op: "!" | "-" | "+" | "typeof"; arg: Expr } & Span)
  | ({ t: "bin"; op: string; l: Expr; r: Expr } & Span)
  | ({ t: "log"; op: "&&" | "||" | "??"; l: Expr; r: Expr } & Span)
  | ({ t: "cond"; test: Expr; then: Expr; else: Expr } & Span)
  | ({ t: "mem"; obj: Expr; prop: Expr; computed: boolean; optional: boolean } & Span)
  | ({ t: "call"; callee: Expr; args: (Expr | SpreadExpr)[]; optional: boolean } & Span)
  | ({ t: "arrow"; params: Param[]; body: Expr | Stmt[] } & Span)
  | ({ t: "assign"; op: "=" | "+=" | "-=" | "*=" | "/=" | "??=" | "||=" | "&&="; target: Expr; value: Expr } & Span)
  | ({ t: "update"; op: "++" | "--"; prefix: boolean; target: Expr } & Span)
  | ({ t: "jsx"; el: ElementNode } & Span)
  | ({ t: "seq"; list: Expr[] } & Span);

export interface SpreadExpr extends Span {
  t: "spread";
  arg: Expr;
}

export type ObjProp =
  | { kind: "prop"; key: string | Expr; computed: boolean; value: Expr }
  | { kind: "spread"; arg: Expr };

export type Param =
  | { kind: "name"; name: string; def?: Expr }
  | { kind: "obj"; names: { key: string; local: string; def?: Expr }[] }
  | { kind: "arr"; names: (string | null)[] };

export type Stmt =
  | { s: "expr"; expr: Expr }
  | { s: "return"; expr: Expr | null }
  | { s: "if"; test: Expr; then: Stmt[]; else: Stmt[] | null }
  | { s: "const"; name: string; value: Expr };

export interface ParseIssue {
  message: string;
  start: number;
  end: number;
  line: number;
  col: number;
}

export interface ParseResult {
  nodes: Node[];
  /** A syntax error in finished input. Streaming input that simply ends early is not an error. */
  error: ParseIssue | null;
  /** True when the input ended in the middle of something (a tag, an expression). */
  incomplete: boolean;
}
