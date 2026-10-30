"""Static policy for CAD source submitted to run_cad (first of several layers, see sandbox.py).

Standalone module (stdlib only): the sandbox child imports it by path to re-check the source
before executing it, so a bug in the parent cannot skip the check.

The policy is an allowlist of what CAD code needs, not a blocklist of known attacks:
  * imports: only `build123d` and `math` (plain `import x`, `from x import ...`, `from x import *`)
  * no names or attributes that start with an underscore (no dunders, no private internals),
    no string constants containing "__" (blocks getattr/format tricks that build dunder names)
  * no builtins that reach the interpreter: eval, exec, compile, open, __import__, getattr,
    setattr, delattr, globals, locals, vars, input, breakpoint, help, memoryview, type, object, ...
  * no class definitions, global/nonlocal, async, await, yield (generators expose frames)
  * no frame/code/introspection attributes (gi_frame, f_globals, tb_frame, ...)
  * size limits: source bytes, AST nodes, nesting depth; int literals bounded
Anything that passes still runs in a separate, resource-limited process without network.
"""
import ast

MAX_SOURCE_BYTES = 64 * 1024
MAX_AST_NODES = 20000
MAX_DEPTH = 60
MAX_INT_LITERAL = 10**9
ALLOWED_MODULES = frozenset({"build123d", "math"})

DENIED_NAMES = frozenset({
    "eval", "exec", "compile", "open", "input", "breakpoint", "help", "exit", "quit",
    "getattr", "setattr", "delattr", "hasattr", "globals", "locals", "vars", "dir",
    "memoryview", "bytearray", "type", "object", "super", "classmethod", "staticmethod",
    "property", "issubclass", "id", "hash", "callable", "iter", "next", "aiter", "anext",
    "copyright", "credits", "license", "os", "sys", "subprocess", "socket", "builtins",
    "importlib", "ctypes", "pathlib", "shutil", "io", "pickle", "marshal", "inspect", "gc",
})
DENIED_ATTRS = frozenset({
    "gi_frame", "gi_code", "gi_yieldfrom", "cr_frame", "cr_code", "ag_frame", "ag_code",
    "f_globals", "f_locals", "f_builtins", "f_back", "f_code", "tb_frame", "tb_next",
    "co_code", "co_consts", "func_globals", "func_code", "mro", "format", "format_map",
    "system", "popen", "spawn", "fork", "execv", "execve", "remove", "unlink", "rmdir",
    "load_library", "LoadLibrary", "cdll", "windll", "modules", "import_module",
    # module objects reachable through attributes of build123d submodules
    "os", "sys", "io", "builtins", "subprocess", "socket", "shutil", "pathlib", "importlib", "ctypes",
    "tempfile", "glob", "platform", "inspect", "types", "gc", "signal", "threading", "multiprocessing",
    "codecs", "pickle", "marshal", "zipfile", "tarfile", "urllib", "http", "requests", "logging", "warnings",
    # file / process access by method name
    "open", "run", "Popen", "call", "check_output", "check_call", "getoutput", "walk", "listdir", "scandir",
    "environ", "getenv", "putenv", "chdir", "mkdir", "makedirs", "rename", "replace", "chmod", "chown",
    "Mesher", "ExportSVG", "ExportDXF",
})
# file I/O by name prefix (build123d export_*/import_* write and read through native code, which
# the child's audit hook cannot see; the child does the exporting itself)
DENIED_PREFIXES = ("export", "import", "write", "read", "save", "load", "dump")
DENIED_NODES = (
    ast.ClassDef, ast.Global, ast.Nonlocal, ast.AsyncFunctionDef, ast.AsyncFor, ast.AsyncWith,
    ast.Await, ast.Yield, ast.YieldFrom,
)


def check_source(src):
    """Return a list of policy violations (empty list = allowed)."""
    if not isinstance(src, str):
        return ["source must be a string"]
    if len(src.encode("utf-8")) > MAX_SOURCE_BYTES:
        return [f"source larger than {MAX_SOURCE_BYTES} bytes"]
    if "\x00" in src:
        return ["NUL byte in source"]
    try:
        tree = ast.parse(src, mode="exec")
    except SyntaxError as e:
        return [f"syntax error: line {e.lineno}: {e.msg}"]
    errors = []

    def err(node, msg):
        errors.append(f"line {getattr(node, 'lineno', '?')}: {msg}")

    count = 0
    stack = [(tree, 0)]
    while stack:
        node, depth = stack.pop()
        count += 1
        if count > MAX_AST_NODES:
            return [f"more than {MAX_AST_NODES} AST nodes"]
        if depth > MAX_DEPTH:
            return [f"nesting deeper than {MAX_DEPTH}"]
        if isinstance(node, DENIED_NODES):
            err(node, f"{type(node).__name__} is not allowed")
        elif isinstance(node, ast.Import):
            for a in node.names:
                if a.name not in ALLOWED_MODULES:
                    err(node, f"import of '{a.name}' is not allowed (only build123d, math)")
                if a.asname and a.asname.startswith("_"):
                    err(node, "underscore alias")
        elif isinstance(node, ast.ImportFrom):
            if node.level or node.module not in ALLOWED_MODULES:
                err(node, f"import from '{node.module}' is not allowed (only build123d, math)")
            for a in node.names:
                if a.name.startswith("_") or (a.asname or "").startswith("_"):
                    err(node, f"import of private name '{a.name}'")
                elif a.name != "*" and (a.name in DENIED_NAMES or a.name.lower().startswith(DENIED_PREFIXES)):
                    err(node, f"import of '{a.name}' is not allowed")
        elif isinstance(node, ast.Name):
            if node.id.startswith("_"):
                err(node, f"name '{node.id}' starts with an underscore")
            elif node.id in DENIED_NAMES or node.id.lower().startswith(DENIED_PREFIXES):
                err(node, f"name '{node.id}' is not allowed")
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("_"):
                err(node, f"attribute '.{node.attr}' starts with an underscore")
            elif node.attr in DENIED_ATTRS or node.attr.lower().startswith(DENIED_PREFIXES):
                err(node, f"attribute '.{node.attr}' is not allowed")
        elif isinstance(node, (ast.FunctionDef, ast.Lambda)):
            if isinstance(node, ast.FunctionDef):
                if node.name.startswith("_") or node.name in DENIED_NAMES:
                    err(node, f"function name '{node.name}' is not allowed")
                if node.decorator_list:
                    err(node, "decorators are not allowed")
            args = node.args
            for a in args.posonlyargs + args.args + args.kwonlyargs + [args.vararg, args.kwarg]:
                if a is not None and a.arg.startswith("_"):
                    err(node, f"argument '{a.arg}' starts with an underscore")
        elif isinstance(node, ast.arg):
            pass
        elif isinstance(node, ast.keyword):
            if node.arg and node.arg.startswith("_"):
                err(node, f"keyword '{node.arg}' starts with an underscore")
        elif isinstance(node, ast.Constant):
            v = node.value
            if isinstance(v, (str, bytes)) and (b"__" if isinstance(v, bytes) else "__") in v:
                err(node, "string constant containing '__'")
            elif isinstance(v, bytes):
                err(node, "bytes literals are not allowed")
            elif isinstance(v, int) and not isinstance(v, bool) and abs(v) > MAX_INT_LITERAL:
                err(node, "integer literal too large")
        elif isinstance(node, ast.alias):
            pass
        elif isinstance(node, ast.ExceptHandler):
            if node.name and node.name.startswith("_"):
                err(node, "underscore exception name")
        elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow):
            # 10**10**10 style constant blow-ups: exponent must be a small literal or a name
            r = node.right
            if isinstance(r, ast.Constant) and isinstance(r.value, (int, float)) and abs(r.value) > 64:
                err(node, "exponent literal too large")
            if isinstance(r, ast.BinOp) and isinstance(r.op, ast.Pow):
                err(node, "nested power is not allowed")
        elif isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Mult, ast.LShift)):
            for side in (node.left, node.right):
                if isinstance(side, ast.Constant) and isinstance(side.value, int) and abs(side.value) > 10**6 and isinstance(node.op, ast.Mult):
                    err(node, "large multiplication literal (sequence blow-up)")
            if isinstance(node.op, ast.LShift):
                err(node, "bit shifts are not allowed")
        for child in ast.iter_child_nodes(node):
            stack.append((child, depth + 1))
    return errors
