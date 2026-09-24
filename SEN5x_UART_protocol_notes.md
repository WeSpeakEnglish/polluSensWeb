# SEN5x UART protocol notes (SEN55)

Sensirion does not publish a UART interface description for the SEN5x family
(all official SEN5x drivers are I2C only). The commands below were mapped by
probing a SEN55, firmware 2.0, over a plain USB-UART converter in September
2026. Verified working with the SEN55_UART.json config in polluSensWeb.

## Physical layer

- UART 115200 baud, 8 data bits, no parity, 1 stop bit
- SEL (pin 5) left floating at power-up selects UART mode
  (tied to GND selects I2C, address 0x69)
- VDD 5 V, RX/TX are 3.3 V LVTTL and 5 V tolerant
- Cross the lines: host TX to sensor RX (pin 3), host RX to sensor TX (pin 4)
- Connector JST ZH 1.5 mm, 6 pin

## Frame layer

Standard Sensirion SHDLC, identical to SPS30 / SVM4x:

- MOSI: 7E | adr | cmd | len | data... | chk | 7E
- MISO: 7E | adr | cmd | state | len | data... | chk | 7E
- adr is always 0x00
- chk = 0xFF - (sum of all body bytes, before stuffing) & 0xFF
- Byte stuffing on 0x7E, 0x7D, 0x11, 0x13 (escape 0x7D, then byte XOR 0x20)
- Multi-byte values big-endian; no per-word CRC (unlike I2C)

State byte error codes observed: 0x00 OK, 0x01 wrong data length,
0x04 illegal parameter, 0x43 command not allowed in current state.

## Commands confirmed on SEN55

| Cmd  | Data      | Function                | Response data                  |
|------|-----------|-------------------------|--------------------------------|
| 0x00 | 0x02      | Start measurement       | none (state 0x43 if already running, harmless) |
| 0x01 | none      | Stop measurement        | none                           |
| 0x03 | 0x0C      | Read measured values    | 16 bytes, see below            |
| 0x03 | 0xFD      | Raw/debug dump          | 94 bytes, mostly IEEE float32, 0xFFFFFFFF placeholders |
| 0xD0 | 0x03      | Read serial number      | ASCII string, null terminated  |
| 0xD1 | none      | Read version            | 7 bytes, byte 0..1 = firmware major.minor |

Parameter sweep note: cmd 0x03 accepts only 0x0C and 0xFD, every other
value returns state 0x04. Cmd 0x02 exists but rejects a 1 byte parameter
with state 0x01, so it expects a different length (not needed for readout,
since 0x03/0x0C always returns the latest values).

## Read measured values payload (cmd 0x03, data 0x0C)

16 bytes, 8 words big-endian, same channel order and scaling as the
documented I2C command 0x03C4:

| Bytes  | Type  | Scale | Channel               |
|--------|-------|-------|-----------------------|
| 0..1   | u16   | /10   | PM1.0  [ug/m3]        |
| 2..3   | u16   | /10   | PM2.5  [ug/m3]        |
| 4..5   | u16   | /10   | PM4.0  [ug/m3]        |
| 6..7   | u16   | /10   | PM10   [ug/m3]        |
| 8..9   | i16   | /100  | Relative humidity [%] |
| 10..11 | i16   | /200  | Temperature [C]       |
| 12..13 | i16   | /10   | VOC index             |
| 14..15 | i16   | /10   | NOx index             |

Unknown values are reported as 0xFFFF (u16) or 0x7FFF (i16) during the
first seconds after start.

## Worked example

Request:  7E 00 03 01 0C EF 7E
Response payload: 00 52 00 58 00 5A 00 5B 11 4C 12 A4 01 A4 00 0A
Decodes to: PM1.0 8.2, PM2.5 8.8, PM4.0 9.0, PM10 9.1 ug/m3,
RH 44.28 %, T 23.86 C, VOC 42.0, NOx 1.0

## Open questions

- Meaning of the mode byte on start (0x02 confirmed working; other values
  untested, possibly RHT/gas-only mode exists as on I2C)
- Exact expected parameter for cmd 0x02 (data ready?)
- Structure of the 0xFD debug dump
- Whether SEN50/SEN54 answer identically (likely, minus their missing channels)
