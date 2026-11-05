import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { formatSource } from "../src/formatter.js";
import { parse } from "../src/parser.js";
import { ParseError } from "../src/errors.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "fx.js");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fx-fmt-"));
}

function run(args, cwd, input) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    input,
  });
}

/** Strip source locations so two ASTs can be compared structurally. */
function stripLoc(value) {
  if (Array.isArray(value)) return value.map(stripLoc);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value))
      if (key !== "loc") out[key] = stripLoc(child);
    return out;
  }
  return value;
}

test("formats declarations, assets and extension calls", () => {
  const source = `sprite "Cat"{
costumes:{fur:"cat.svg","hat color":"hat.svg"};
sounds:{"meow":"meow.wav"};
layer:2;
let x=1;
cloud let online=false;
list items=["a","b"];
when signals.onBang("x"){signals.emit("go",1);}
}`;
  assert.equal(
    formatSource(source, "cat.tfx"),
    `sprite "Cat" {
    costumes: {
        fur: "cat.svg",
        "hat color": "hat.svg"
    };
    sounds: {
        meow: "meow.wav"
    };
    layer: 2;

    let x = 1;
    cloud let online = false;
    list items = ["a", "b"];

    when signals.onBang("x") {
        signals.emit("go", 1);
    }
}
`,
  );
});

test("formats nested control flow, expressions and alternate branches", () => {
  const source = `stage{when greenFlag{if(a or b and not c){repeat(2){motion.moveSteps(1+2*3);}}else if(x>=1){while x<10{x+=1;}}else{forever{looks.say("a\\"b");}}}}`;
  assert.equal(
    formatSource(source, "nested.tfx"),
    `stage {
    when greenFlag {
        if (a or b and not c) {
            repeat (2) {
                motion.moveSteps(1 + 2 * 3);
            }
        } else if (x >= 1) {
            while (x < 10) {
                x += 1;
            }
        } else {
            forever {
                looks.say("a\\"b");
            }
        }
    }
}
`,
  );
});

test("parenthesizes only where the parse tree needs it", () => {
  const source = `sprite "S"{let x=10-(2-1)+((10-2)-1);let y=not(a and b);let z=-x;let s=[1,"a\\tb"];}`;
  assert.equal(
    formatSource(source, "expr.tfx"),
    `sprite "S" {
    let x = 10 - (2 - 1) + (10 - 2 - 1);
    let y = not (a and b);
    let z = -x;
    let s = [1, "a\\tb"];
}
`,
  );
});

test("keeps comments and their placement", () => {
  const source = `// header
sprite "S" { // opening
    let x = 1; // trailing
    // before hat
    when greenFlag {
        // inside
        if (x > 0) { // condition note
            looks.show();
        } else {
            looks.hide(); // hidden
        }
        /* done */
    }
}
// footer
`;
  assert.equal(
    formatSource(source, "comments.tfx"),
    `// header
sprite "S" { // opening
    let x = 1; // trailing

    // before hat
    when greenFlag {
        // inside
        if (x > 0) { // condition note
            looks.show();
        } else {
            looks.hide(); // hidden
        }
        /* done */
    }
}
// footer
`,
  );
});

test("preserves intentional blank lines and collapses extras", () => {
  const source = `// header\n\n\n
sprite "S" {
    let a = 1;


    // section

    when greenFlag {
        control.forever {
            looks.show();
        }
    }
}`;
  assert.equal(
    formatSource(source, "blank.tfx"),
    `// header

sprite "S" {
    let a = 1;

    // section
    when greenFlag {
        control.forever {
            looks.show();
        }
    }
}
`,
  );
});

test("omits empty parentheses on block calls with a body", () => {
  const source = `sprite "S"{when greenFlag{control.forever{motion.moveSteps(1);}custom.loop(1){looks.show();}}}`;
  const formatted = formatSource(source, "blocks.tfx");
  assert.match(formatted, /control\.forever \{\n/);
  assert.match(formatted, /custom\.loop\(1\) \{\n/);
});

test("preserves partial sprites and parameter types", () => {
  const source = `partial sprite "Cat"{function f(a:number,b:boolean){return a;}}`;
  assert.equal(
    formatSource(source, "partial.tfx"),
    `partial sprite "Cat" {
    function f(a: number, b: boolean) {
        return a;
    }
}
`,
  );
});

test("formatting is idempotent and keeps the AST unchanged", () => {
  const sources = [
    `sprite "S"{let x=1;when greenFlag{if x{looks.say("hi");}else{looks.hide();}}}`,
    `stage{let g=0;list items=[];when keyPressed("space"){items.push(g);}}`,
    `sprite "S"{returning warp function f(a:number){}}`,
    `// only a comment\n`,
  ];
  for (const source of sources) {
    const once = formatSource(source, "idempotent.tfx");
    assert.equal(formatSource(once, "idempotent.tfx"), once);
    assert.deepEqual(
      stripLoc(parse(once, "idempotent.tfx")),
      stripLoc(parse(source, "idempotent.tfx")),
    );
  }
});

test("reports malformed input with a location and never guesses", () => {
  assert.throws(
    () => formatSource('sprite "S" { let x = ; }', "bad.tfx"),
    (error) => {
      assert.ok(error instanceof ParseError);
      assert.equal(error.file, "bad.tfx");
      assert.equal(error.line, 1);
      return true;
    },
  );
});

test("fx fmt writes files, checks without writing, and is idempotent", () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "fx.yml"), 'project:\n  name: "Demo"\n');
    const file = path.join(dir, "src", "main.tfx");
    const messy = 'sprite "S"{let x=1;}\n';
    const clean = 'sprite "S" {\n    let x = 1;\n}\n';
    fs.writeFileSync(file, messy);

    const checked = run(["fmt", "--check"], dir);
    assert.equal(checked.status, 1, checked.stderr);
    assert.match(checked.stderr, /would be reformatted/);
    assert.equal(fs.readFileSync(file, "utf8"), messy);

    const formatted = run(["fmt"], dir);
    assert.equal(formatted.status, 0, formatted.stderr);
    assert.equal(fs.readFileSync(file, "utf8"), clean);

    const again = run(["fmt"], dir);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /already formatted/);
    assert.equal(run(["fmt", "--check"], dir).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fx fmt --check --json reports unformatted files without writing", () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "fx.yml"), 'project:\n  name: "Demo"\n');
    const file = path.join(dir, "src", "main.tfx");
    const messy = 'sprite "S"{let x=1;}\n';
    fs.writeFileSync(file, messy);

    const result = run(["fmt", "--check", "--json"], dir);
    assert.equal(result.status, 1, result.stderr);
    const document = JSON.parse(result.stdout);
    assert.equal(document.ok, false);
    assert.equal(document.command, "fmt");
    assert.equal(document.data.changed, 1);
    assert.equal(document.data.checked, true);
    assert.equal(document.data.files[0].status, "unformatted");
    assert.equal(fs.readFileSync(file, "utf8"), messy);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fx fmt leaves unparseable files untouched and reports the location", () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "fx.yml"), 'project:\n  name: "Demo"\n');
    const file = path.join(dir, "src", "bad.tfx");
    const broken = 'sprite "S" { let x = ; }\n';
    fs.writeFileSync(file, broken);

    const result = run(["fmt"], dir);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /ParseError/);
    assert.match(result.stderr, /bad\.tfx:1:/);
    assert.equal(fs.readFileSync(file, "utf8"), broken);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fx fmt --stdout and --stdin support pipelines", () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "fx.yml"), 'project:\n  name: "Demo"\n');
    const file = path.join(dir, "src", "main.tfx");
    const messy = 'sprite "S"{let x=1;}\n';
    const clean = 'sprite "S" {\n    let x = 1;\n}\n';
    fs.writeFileSync(file, messy);

    const stdout = run(["fmt", "src/main.tfx", "--stdout"], dir);
    assert.equal(stdout.status, 0, stdout.stderr);
    assert.equal(stdout.stdout, clean);
    assert.equal(fs.readFileSync(file, "utf8"), messy);

    const stdin = run(["fmt", "--stdin"], dir, messy);
    assert.equal(stdin.status, 0, stdin.stderr);
    assert.equal(stdin.stdout, clean);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
