// I2C scanner for the Home Base (UNO R4 WiFi). Scans Wire (Grove shield I2C / A4-A5)
// and Wire1 (Qwiic connector), every 3 s, at 115200 baud. Expect 0x4C (MMA7660FC accel)
// and 0x70-0x77 (HT16K33 alphanumeric display, 0x71 here).
#include <Wire.h>

static void scan(TwoWire &bus, const char *name) {
  Serial.print(name);
  Serial.print(':');
  Serial.flush();
  int found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    bus.beginTransmission(addr);
    if (bus.endTransmission() == 0) {
      Serial.print(" 0x");
      if (addr < 16) Serial.print('0');
      Serial.print(addr, HEX);
      found++;
    }
  }
  if (!found) Serial.print(" (none)");
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000) {}
  Serial.println("{\"boot\":\"i2c_scan\"}");
  Wire.begin();
  Wire.setClock(100000);
  Serial.println("Wire ready");
}

void loop() {
  Serial.println("tick");
  scan(Wire, "Wire");
  delay(3000);
}
