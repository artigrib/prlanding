"""Device packages: load devices/<id>/device.json and everything it points to.

forge code asks the Device for the sim model, mount library, joint groups, sweep grids, poses, actuator
stall torques and the check profile instead of naming SO-101 files or joints. Paths in device.json are
repo-relative except `checks`, which is relative to the device folder.

validate(obj, schema) is a small JSON-Schema subset (type, required, properties, additionalProperties,
items, enum, pattern, minimum/maximum, minItems/maxItems, oneOf, $ref to #/$defs) so the loader needs no
extra dependency; tests use the same function on the files in devices/schema/.
"""
import copy
import functools
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DEVICES = os.path.join(ROOT, "devices")
SCHEMAS = os.path.join(DEVICES, "schema")
DEFAULT = "so101"


class DeviceError(ValueError):
    pass


def _read(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


_TYPES = {"object": dict, "array": list, "string": str, "boolean": bool, "integer": int, "number": (int, float), "null": type(None)}


def _is(v, t):
    if t in ("integer", "number") and isinstance(v, bool):
        return False
    return isinstance(v, _TYPES[t])


def validate(obj, schema, path="$", root=None):
    """Return a list of error strings (empty = valid)."""
    root = root if root is not None else schema
    errs = []
    if "$ref" in schema:
        ref = schema["$ref"]
        if not ref.startswith("#/"):
            raise DeviceError(f"unsupported $ref {ref}")
        node = root
        for k in ref[2:].split("/"):
            node = node[k]
        return validate(obj, node, path, root)
    t = schema.get("type")
    if t is not None:
        ts = t if isinstance(t, list) else [t]
        if not any(_is(obj, x) for x in ts):
            return [f"{path}: expected {t}, got {type(obj).__name__}"]
    if "oneOf" in schema:
        ok = sum(1 for s in schema["oneOf"] if not validate(obj, s, path, root))
        if ok != 1:
            errs.append(f"{path}: matches {ok} of oneOf")
    if "enum" in schema and obj not in schema["enum"]:
        errs.append(f"{path}: {obj!r} not in {schema['enum']}")
    if isinstance(obj, str) and "pattern" in schema and not re.search(schema["pattern"], obj):
        errs.append(f"{path}: {obj!r} does not match {schema['pattern']}")
    if _is(obj, "number"):
        if "minimum" in schema and obj < schema["minimum"]:
            errs.append(f"{path}: {obj} < {schema['minimum']}")
        if "maximum" in schema and obj > schema["maximum"]:
            errs.append(f"{path}: {obj} > {schema['maximum']}")
        if "exclusiveMinimum" in schema and obj <= schema["exclusiveMinimum"]:
            errs.append(f"{path}: {obj} <= {schema['exclusiveMinimum']}")
    if isinstance(obj, list):
        if len(obj) < schema.get("minItems", 0):
            errs.append(f"{path}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(obj) > schema["maxItems"]:
            errs.append(f"{path}: more than {schema['maxItems']} items")
        if "items" in schema:
            for i, v in enumerate(obj):
                errs += validate(v, schema["items"], f"{path}[{i}]", root)
    if isinstance(obj, dict):
        for k in schema.get("required", []):
            if k not in obj:
                errs.append(f"{path}: missing {k}")
        props = schema.get("properties", {})
        extra = schema.get("additionalProperties", True)
        for k, v in obj.items():
            if k in props:
                errs += validate(v, props[k], f"{path}.{k}", root)
            elif extra is False:
                errs.append(f"{path}: unexpected key {k}")
            elif isinstance(extra, dict):
                errs += validate(v, extra, f"{path}.{k}", root)
    return errs


@functools.lru_cache(maxsize=None)
def schema(name):
    return _read(os.path.join(SCHEMAS, f"{name}.schema.json"))


def _check(obj, name, where):
    errs = validate(obj, schema(name))
    if errs:
        raise DeviceError(f"{where}: " + "; ".join(errs[:8]))


class Device:
    def __init__(self, dev_id, root=ROOT, devices_dir=None):
        self.root = root
        self.dir = os.path.join(devices_dir or os.path.join(root, "devices"), dev_id)
        path = os.path.join(self.dir, "device.json")
        if not re.fullmatch(r"[a-z0-9_]+", dev_id or "") or not os.path.isfile(path):
            raise DeviceError(f"unknown device {dev_id!r}")
        self.spec = _read(path)
        _check(self.spec, "device", path)
        if self.spec["id"] != dev_id:
            raise DeviceError(f"{path}: id {self.spec['id']!r} != folder {dev_id!r}")
        self.id = dev_id
        self.name = self.spec["name"]
        self.mounts = _read(self.path(self.spec["mounts"]))
        _check(self.mounts, "mounts", self.spec["mounts"])
        ids = {i["id"] for i in self.mounts["interfaces"]}
        for k in [self.spec.get("default_mount")] + list(self.spec.get("sandwich", {})):
            if k and k not in ids:
                raise DeviceError(f"{path}: mount {k!r} not in {self.spec['mounts']}")
        self.ports = None
        if self.spec.get("ports"):
            self.ports = _read(self.path(self.spec["ports"]))
            _check(self.ports, "ports", self.spec["ports"])
        self.checks = {}
        if self.spec.get("checks"):
            cp = os.path.join(self.dir, self.spec["checks"])
            self.checks = _read(cp)
            _check(self.checks, "checks", cp)
        if not os.path.isfile(self.model_xml):
            raise DeviceError(f"{path}: model {self.model_xml} missing")

    def path(self, rel):
        return os.path.join(self.root, rel)

    # model
    @property
    def model_dir(self):
        return self.path(self.spec["model"]["dir"])

    @property
    def model_xml(self):
        return os.path.join(self.model_dir, self.spec["model"]["xml"])

    @property
    def meshdir(self):
        return self.spec["model"].get("meshdir", "assets")

    # kinematics / sweeps
    @property
    def tcp_site(self):
        return self.spec.get("tcp_site")

    @property
    def joints(self):
        return list(self.spec["joints"].get("all", []))

    @property
    def torque_joints(self):
        return list(self.spec["joints"]["torque"])

    def grid(self, name):
        return dict(self.spec["sweep"][name])

    def pose(self, name):
        return dict(self.spec.get("poses", {}).get(name, {}))

    @property
    def stall_nm(self):
        return dict(self.spec.get("actuators", {}).get("stall_nm", {}))

    # mounts
    @property
    def sandwich(self):
        return dict(self.spec.get("sandwich", {}))

    @property
    def default_mount(self):
        return self.spec.get("default_mount")

    @property
    def moves_with(self):
        return tuple(self.spec.get("moves_with", ["any"]))

    def mount(self, mid):
        return next((i for i in self.mounts["interfaces"] if i["id"] == mid), None)

    def check(self, section, key=None, default=None):
        """Check-profile value, e.g. check('collision', 'margin_mm', 2.0). Hook for new checks."""
        sec = self.checks.get(section) or {}
        return copy.deepcopy(sec if key is None else sec.get(key, default))

    def enabled(self, section):
        return bool((self.checks.get(section) or {}).get("enabled", False))

    @property
    def prompt_name(self):
        return self.spec["prompt"]["name"]

    @property
    def prompt_scope(self):
        return self.spec["prompt"]["scope"]


def list_devices(devices_dir=DEVICES):
    return sorted(d for d in os.listdir(devices_dir) if os.path.isfile(os.path.join(devices_dir, d, "device.json")))


@functools.lru_cache(maxsize=None)
def load_device(dev_id=DEFAULT):
    return Device(dev_id)
