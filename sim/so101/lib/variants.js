// SO-101 servo variants (kit data, used by the wizard, diagnostics and the emulator) — printedrobotics.cz.
// maxV/minV are the emulator's factory voltage limits (0.1 V); okLo/okHi the supply range the
// diagnostics accept. The emulated limits are plausible values, not verified against a datasheet.
export const VARIANTS = {
  '7.4': { label: '7,4 V', nominal: 7.4, supply: 5.0, maxV: 90, minV: 40, okLo: 4.5, okHi: 8.4 },
  '12': { label: '12 V', nominal: 12, supply: 12.0, maxV: 140, minV: 60, okLo: 10.5, okHi: 13.0 }
};
