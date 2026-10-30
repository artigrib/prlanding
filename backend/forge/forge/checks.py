"""Engineering checks that need no simulator: printability and the LED power circuit."""
import math

import trimesh

from .geometry import overhang_area

MIN_WALL_MM = 1.2
E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82]


def printability(stl_path, report, build_dir, bed=(180, 180, 180)):
    mesh = trimesh.load_mesh(stl_path, process=True)
    wall = (report.get("wall") or {}).get("min_wall_mm")
    over = overhang_area(mesh, build_dir, 45.0)
    up = [float(v) for v in build_dir]
    size = report["size_mm"]
    ok_wall = wall is not None and wall >= MIN_WALL_MM
    return {
        "min_wall_mm": wall,
        "min_wall_required_mm": MIN_WALL_MM,
        "wall_ok": ok_wall,
        "build_dir": up,
        "overhang_area_mm2_over_45deg": over,
        "overhang_note": "The LED bore lies horizontally in the print orientation: Ø≈10 mm round holes print without supports in PLA (slight droop at the top, ream with a 10 mm drill by hand if the LED does not slide in). No other supports needed.",
        "overhang_note_cs": "Otvor pro LED leží při tisku vodorovně: kruhový otvor Ø≈10 mm se v PLA vytiskne bez podpor (strop se mírně prověsí, případně protáhněte ručně vrtákem 10 mm). Jiné podpory nejsou potřeba.",
        "watertight": report["watertight"],
        "fits_bed": all(s <= b for s, b in zip(sorted(size), sorted(bed))),
        "settings": "PLA, 0.4 mm nozzle, 0.2 mm layers, 3 perimeters, 30 % infill, plate face on the bed",
        "settings_cs": "PLA, tryska 0,4 mm, vrstva 0,2 mm, 3 perimetry, výplň 30 %, destičkou na podložku",
        "ok": ok_wall and report["watertight"],
    }


def e12_at_least(r):
    dec = 10 ** math.floor(math.log10(r))
    for k in (1, 10):
        for v in E12:
            if v * dec / 10 * k >= r - 1e-9:
                return v * dec / 10 * k
    return E12[0] * dec * 10


def led_circuit(vs_nom, vs_min, vs_max, vf_typ, vf_min, vf_max, if_target_ma, if_max_ma):
    """Series resistor for one LED. Picks the next E12 value up that keeps the worst-case current
    (highest supply, lowest Vf) at or below if_max_ma."""
    r = (vs_nom - vf_typ) / (if_target_ma / 1000.0)
    r = e12_at_least(r)
    while (vs_max - vf_min) / r * 1000.0 > if_max_ma:
        r = e12_at_least(r * 1.01)
    i_typ = (vs_nom - vf_typ) / r * 1000.0
    i_lo = (vs_min - vf_max) / r * 1000.0
    i_hi = (vs_max - vf_min) / r * 1000.0
    p_r = (i_hi / 1000.0) ** 2 * r
    return {"supply_v": [vs_min, vs_nom, vs_max], "vf_v": [vf_min, vf_typ, vf_max], "r_ohm": round(r, 1),
            "i_ma": {"min": round(i_lo, 1), "typ": round(i_typ, 1), "max": round(i_hi, 1)},
            "p_resistor_mw_max": round(p_r * 1000.0, 1), "resistor_rating": "0.25 W or more",
            "p_led_mw_typ": round(vf_typ * i_typ, 1), "p_total_mw_typ": round(vs_nom * i_typ, 1)}


def electrical(led):
    usb = led_circuit(5.0, 4.75, 5.25, led["vf_typ"], led["vf_min"], led["vf_max"], 15.0, led["if_max_ma"])
    buck = dict(usb)
    return {
        "load": f"1× {led['name']} (Vf {led['vf_typ']} V typ., If {led['if_nom_ma']} mA nominal)",
        "recommended": {
            "id": "usb5v",
            "name": "USB 5 V from the PC or a USB charger, series resistor",
            "name_cs": "USB 5 V z počítače nebo USB nabíječky, sériový rezistor",
            "circuit": usb,
            "why": "Independent of the servo supply (the arm runs on 12 V or 7.4 V servos; mixing them up is the classic mistake). A USB port gives 500 mA; we draw ≈15 mA.",
            "why_cs": "Nezávislé na napájení serv (rameno jede na 12 V nebo 7,4 V; jejich záměna je klasická chyba). USB port dá 500 mA, odebíráme ≈15 mA.",
            "wiring": "USB-A plug: VBUS (red) → resistor → LED anode (long leg); LED cathode (short leg, flat side) → GND (black). Heat-shrink over the resistor and both LED legs. Optional inline switch in VBUS.",
            "wiring_cs": "USB-A: VBUS (červený) → rezistor → anoda LED (delší nožička); katoda (kratší, plochá strana) → GND (černý). Smršťovací bužírka na rezistor i obě nožičky. Volitelně vypínač do VBUS.",
        },
        "power_bank_note": "A USB power bank works only if it has a low-current / always-on mode: most banks switch off below ≈50–100 mA, and this light draws ≈15 mA.",
        "power_bank_note_cs": "Powerbanka funguje jen s režimem pro malý odběr (always-on): většina se pod ≈50–100 mA sama vypne a světlo bere ≈15 mA.",
        "alternative": {
            "id": "buck5v",
            "name": "Small buck module to 5 V from the servo power supply (12 V or 7.4 V), same resistor",
            "name_cs": "Malý step-down modul na 5 V z napájení serv (12 V nebo 7,4 V), stejný rezistor",
            "circuit": buck,
            "conditions": "Module input range must cover the servo PSU voltage (≥ 15 V rating for a 12 V PSU); set/verify 5.0 V with a multimeter BEFORE connecting the LED; 250 mA fuse or polyfuse in the module input; common ground with the bus board is fine.",
            "conditions_cs": "Vstupní rozsah modulu musí pokrýt napětí zdroje serv (pro 12 V zdroj aspoň 15 V); 5,0 V nastavte a změřte multimetrem DŘÍV, než připojíte LED; pojistka nebo polyswitch 250 mA na vstupu modulu; společná zem se servo deskou nevadí.",
        },
        "never": ["mains voltage anywhere near the arm", "LiPo / bare Li-ion cells", "LED straight on the servo rail without a resistor"],
        "never_cs": ["síťové napětí kdekoli u ramene", "LiPo / nechráněné Li-ion články", "LED přímo na napájení serv bez rezistoru"],
        "cable": "2-core 0.14–0.25 mm² (26–24 AWG) flexible cable, ≈1 m. Leave a 60–80 mm service loop at the wrist (wrist roll turns ±157°) and tie the cable to the servo cables along the forearm.",
        "cable_cs": "Dvoužilový ohebný kabel 0,14–0,25 mm² (26–24 AWG), ≈1 m. U zápěstí nechte smyčku 60–80 mm (rotace zápěstí ±157°) a kabel přivažte k servokabelům podél předloktí.",
        "ok": usb["i_ma"]["max"] <= led["if_max_ma"],
    }
