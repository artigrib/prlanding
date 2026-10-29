"""Czech + English display names for auto-imported assets, derived from the package name.

  derive("handTool_screwdriver_slotted_4mm_a01") -> ("Šroubovák plochý 4 mm", "Slotted screwdriver 4 mm", True)
  derive("factory_nut_m12_loose")               -> ("Matice M12", "M12 nut", True)
  derive("weird_gizmo_a01")                     -> ("Weird gizmo", "Weird gizmo", False)   # flagged for a human

Dictionary: names.json (nouns with Czech gender, modifiers with gendered Czech forms). Czech word order: noun +
modifiers + size ("Kelímek papírový"); English: modifiers + noun + size, thread sizes first ("M12 nut").
"""
import json
import re
from pathlib import Path

D = json.loads((Path(__file__).resolve().parent / "names.json").read_text(encoding="utf-8"))
GENDER = {"m": 0, "f": 1, "n": 2, "p": 3}


def tokens(text):
    t = re.sub(r"([a-z])([A-Z])", r"\1 \2", str(text))
    return [x for x in re.split(r"[^a-z0-9]+", t.lower()) if x]


def _sizes(toks):
    """Pull size codes out of the token list: M12, PH2, T10, 4 mm, 1/2"."""
    out, rest, i = {"thread": None, "other": []}, [], 0
    while i < len(toks):
        t = toks[i]
        if re.fullmatch(r"m\d{1,2}", t):
            out["thread"] = t.upper()
        elif re.fullmatch(r"(ph|pz|t|sw)\d{1,2}", t):
            out["other"].append(t.upper())
        elif re.fullmatch(r"\d+(\.\d+)?mm", t):
            out["other"].append(t[:-2] + " mm")
        elif re.fullmatch(r"\d+", t) and i + 1 < len(toks) and re.fullmatch(r"\d+in", toks[i + 1]):
            out["other"].append(f'{t}/{toks[i + 1][:-2]}"')
            i += 1
        elif re.fullmatch(r"\d+in", t):
            out["other"].append(t[:-2] + '"')
        elif re.fullmatch(r"[a-z]\d\d", t) or re.fullmatch(r"\d+", t):
            pass  # variant code (a01) or stray number
        else:
            rest.append(t)
        i += 1
    return out, rest


def derive(name):
    out, toks = _sizes(tokens(name))
    toks = [t for t in toks if t not in D["skip"]]
    noun, mods = None, []
    used = set()
    # bigrams first (e.g. "cup tea", "bearing ball", "dragon fruit"), then single tokens; first noun wins
    for k in range(len(toks)):
        for key in ([f"{toks[k]} {toks[j]}" for j in range(k + 1, len(toks))] + [toks[k]]):
            if key in D["nouns"] and noun is None:
                noun = D["nouns"][key]
                used.update(key.split())
        if noun:
            break
    for k in range(len(toks)):
        if toks[k] in used:
            continue
        pair = f"{toks[k]} {toks[k + 1]}" if k + 1 < len(toks) else None
        if pair and pair in D["mods"] and toks[k + 1] not in used:
            mods.append(D["mods"][pair]); used.update(pair.split())
        elif toks[k] in D["mods"]:
            mods.append(D["mods"][toks[k]]); used.add(toks[k])
    if noun is None:
        en = " ".join(toks + ([out["thread"]] if out["thread"] else []) + out["other"]).strip() or str(name)
        en = en[0].upper() + en[1:]
        return en, en, False
    cs_noun, en_noun, g = noun
    gi = GENDER[g]
    cs = " ".join([cs_noun] + [m[gi] for m in mods] + ([out["thread"]] if out["thread"] else []) + out["other"])
    en = " ".join(([out["thread"]] if out["thread"] else []) + [m[4] for m in mods] + [en_noun] + out["other"])
    return cs, en[0].upper() + en[1:], True
