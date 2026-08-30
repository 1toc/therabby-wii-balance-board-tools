# WBB protocol notes

This prototype reuses the working WebHID path used by the Therabby Wii Balance Board tools.

- Nintendo Vendor ID: 0x057E
- Wii Balance Board Product ID: 0x0306
- report mode: 0x32
- calibration register: 0xA40024 (24 bytes)
- report sensor order: TR / BR / TL / BL
- calibration levels: 0 kg / 17 kg / 34 kg
- normalized CoP:
  - X = (Right - Left) / Total
  - Y = (Front - Back) / Total

Limits of Stability v0.1:
- ZERO = unloaded sensor reference
- CENTER = standing CoP reference
- relative CoP = absolute normalized CoP - CENTER
- maximum excursion = maximum projection onto each target direction
- values are normalized, not physical mm/cm
