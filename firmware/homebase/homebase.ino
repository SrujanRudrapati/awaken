/*
 * Oath Home Base firmware — Arduino UNO R4 WiFi + Grove shield.
 *
 * Board: arduino:renesas_uno:unor4wifi · Serial 115200 · see HARDWARE_TODO.md for upload steps.
 * Libraries: Adafruit LED Backpack Library 1.5.1 (+ Adafruit GFX 1.13.0, Adafruit BusIO 1.17.4),
 *            Servo 1.3.0. The MMA7660FC is read directly (its Seeed library can spin forever
 *            on a stuck alert bit, which would freeze the whole Home Base).
 *
 * Pins:  Button D2 · Buzzer D4 · Servo D5 (optional) · Push-up pad / micro switch D6 ·
 *        IR reflective D7 (optional) · Light A0 · Sound A1 ·
 *        I2C (Wire, shield): MMA7660FC accel 0x4C, HT16K33 4-char alphanumeric 0x71.
 *        (Wire1 / Qwiic is never touched: with nothing attached the R4 core blocks on it.)
 *
 * Out, every 100 ms, one JSON line:
 *   {"t":ms,"pad":0|1,"btn":0|1,"light":0-1023,"snd":0-1023,"ax":g,"ay":g,"az":g,"jail":0|1|null,"servo":"locked"|"unlocked"|null}
 *   Absent hardware → null. `snd` is the loudest sample in the 100 ms window.
 *   Boot: {"boot":"homebase","fw":"oath-1","accel":bool,"display":bool}
 * In, one per line: SEG:<4 chars> · LOCK · UNLOCK · BUZZ:chime|alarm|tick · CFG:IR:0|1 · CFG:SERVO:0|1
 *   Each command is acknowledged: {"ack":"<cmd>","ok":true|false}
 */
#include <Wire.h>
#include <Servo.h>
#include <Adafruit_LEDBackpack.h>

// ── Pins & settings ─────────────────────────────────────────────────────────
const uint8_t PIN_BTN = 2;
const uint8_t PIN_BUZZER = 4;
const uint8_t PIN_SERVO = 5;
const uint8_t PIN_PAD = 6;
const uint8_t PIN_IR = 7;
const uint8_t PIN_LIGHT = A0;
const uint8_t PIN_SOUND = A1;

const uint8_t ADDR_ACCEL = 0x4C;
const uint8_t ADDR_DISPLAY = 0x71;

// Switch polarity: flip if `npm run hw:check` shows the pad/button inverted.
const bool PAD_ACTIVE_HIGH = true;
const bool BTN_ACTIVE_HIGH = true;
// Grove IR reflective sensor pulls LOW when something reflective (a phone) is in front of it.
const bool IR_ACTIVE_LOW = true;

const uint8_t SERVO_LOCKED_DEG = 90;
const uint8_t SERVO_UNLOCKED_DEG = 0;
const unsigned long SAMPLE_MS = 100;
const uint8_t CMD_MAX = 32;

// ── State ───────────────────────────────────────────────────────────────────
Adafruit_AlphaNum4 display;
Servo servo;

bool hasAccel = false;
bool hasDisplay = false;
bool hasIr = false;     // enabled by CFG:IR:1 (sent by the bridge when HOMEBASE_IR=1)
bool hasServo = false;  // enabled by CFG:SERVO:1
bool servoLocked = false;

unsigned long lastSample = 0;
int soundPeak = 0;
char cmd[CMD_MAX + 1];
uint8_t cmdLen = 0;

// ── Buzzer: non-blocking note sequences ─────────────────────────────────────
struct Note { uint16_t freq; uint16_t ms; };
const Note CHIME[] = {{1047, 110}, {0, 30}, {1319, 110}, {0, 30}, {1568, 220}};
const Note ALARM[] = {{880, 180}, {0, 80}, {660, 180}, {0, 80}, {880, 180}, {0, 80}, {660, 300}};
const Note TICK[] = {{2000, 25}};
const Note *melody = nullptr;
uint8_t melodyLen = 0;
uint8_t melodyIdx = 0;
unsigned long noteEndsAt = 0;

void playMelody(const Note *notes, uint8_t len) {
  melody = notes;
  melodyLen = len;
  melodyIdx = 0;
  noteEndsAt = 0;
}

void updateBuzzer(unsigned long now) {
  if (!melody || now < noteEndsAt) return;
  if (melodyIdx >= melodyLen) {
    noTone(PIN_BUZZER);
    melody = nullptr;
    return;
  }
  const Note &n = melody[melodyIdx++];
  if (n.freq) tone(PIN_BUZZER, n.freq); else noTone(PIN_BUZZER);
  noteEndsAt = now + n.ms;
}

// ── MMA7660FC (datasheet: 6-bit two's complement, 21.33 counts/g, bit 6 = alert) ──
const uint8_t MMA_XOUT = 0x00;
const uint8_t MMA_MODE = 0x07;
const uint8_t MMA_SR = 0x08;
const float MMA_COUNTS_PER_G = 21.33f;
float lastG[3] = {0, 0, 0};

void mmaWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(ADDR_ACCEL);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

void mmaInit() {
  mmaWrite(MMA_MODE, 0x00);  // standby to configure
  mmaWrite(MMA_SR, 0x00);    // 120 samples/s
  mmaWrite(MMA_MODE, 0x01);  // active
}

/** Updates lastG from one 3-byte read; keeps the previous value for an axis mid-update. Never blocks. */
void mmaRead() {
  Wire.beginTransmission(ADDR_ACCEL);
  Wire.write(MMA_XOUT);
  if (Wire.endTransmission(false) != 0) return;
  if (Wire.requestFrom(ADDR_ACCEL, (uint8_t)3) != 3) return;
  for (uint8_t i = 0; i < 3 && Wire.available(); i++) {
    uint8_t raw = Wire.read();
    if (raw & 0x40) continue;                        // alert: register being updated
    int8_t v = (raw & 0x20) ? (int8_t)(raw | 0xC0) : (int8_t)(raw & 0x3F);
    lastG[i] = v / MMA_COUNTS_PER_G;
  }
}

// ── Devices ─────────────────────────────────────────────────────────────────
bool i2cPresent(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

void showText(const char *text) {
  if (!hasDisplay) return;
  for (uint8_t i = 0; i < 4; i++) display.writeDigitAscii(i, text[i] ? text[i] : ' ');
  display.writeDisplay();
}

void setServo(bool locked) {
  servoLocked = locked;
  if (hasServo) servo.write(locked ? SERVO_LOCKED_DEG : SERVO_UNLOCKED_DEG);
}

void enableServo(bool on) {
  if (on && !hasServo) servo.attach(PIN_SERVO);
  if (!on && hasServo) servo.detach();
  hasServo = on;
  if (on) setServo(servoLocked);
}

// ── Commands ────────────────────────────────────────────────────────────────
void ack(const char *c, bool ok) {
  Serial.print("{\"ack\":\"");
  Serial.print(c);
  Serial.print("\",\"ok\":");
  Serial.print(ok ? "true" : "false");
  Serial.println("}");
}

void handleCommand(const char *c) {
  bool ok = true;
  if (strncmp(c, "SEG:", 4) == 0 && strlen(c) == 8) {
    showText(c + 4);
    ok = hasDisplay;
  } else if (strcmp(c, "LOCK") == 0) {
    setServo(true);
    ok = hasServo;
  } else if (strcmp(c, "UNLOCK") == 0) {
    setServo(false);
    ok = hasServo;
  } else if (strcmp(c, "BUZZ:chime") == 0) {
    playMelody(CHIME, sizeof(CHIME) / sizeof(Note));
  } else if (strcmp(c, "BUZZ:alarm") == 0) {
    playMelody(ALARM, sizeof(ALARM) / sizeof(Note));
  } else if (strcmp(c, "BUZZ:tick") == 0) {
    playMelody(TICK, sizeof(TICK) / sizeof(Note));
  } else if (strcmp(c, "CFG:IR:1") == 0 || strcmp(c, "CFG:IR:0") == 0) {
    hasIr = c[7] == '1';
  } else if (strcmp(c, "CFG:SERVO:1") == 0 || strcmp(c, "CFG:SERVO:0") == 0) {
    enableServo(c[10] == '1');
  } else {
    ok = false;
  }
  ack(c, ok);
}

void readCommands() {
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\r') continue;
    if (ch == '\n') {
      cmd[cmdLen] = '\0';
      if (cmdLen) handleCommand(cmd);
      cmdLen = 0;
    } else if (cmdLen < CMD_MAX) {
      cmd[cmdLen++] = ch;
    }
  }
}

// ── Readings ────────────────────────────────────────────────────────────────
int readSwitch(uint8_t pin, bool activeHigh) {
  int v = digitalRead(pin);
  return activeHigh ? v : !v;
}

void printBit(const char *key, int v) {
  Serial.print(",\"");
  Serial.print(key);
  Serial.print("\":");
  Serial.print(v);
}

void sendReading(unsigned long now) {
  Serial.print("{\"t\":");
  Serial.print(now);
  printBit("pad", readSwitch(PIN_PAD, PAD_ACTIVE_HIGH));
  printBit("btn", readSwitch(PIN_BTN, BTN_ACTIVE_HIGH));
  printBit("light", analogRead(PIN_LIGHT));
  printBit("snd", soundPeak);
  if (hasAccel) {
    mmaRead();
    Serial.print(",\"ax\":"); Serial.print(lastG[0], 2);
    Serial.print(",\"ay\":"); Serial.print(lastG[1], 2);
    Serial.print(",\"az\":"); Serial.print(lastG[2], 2);
  } else {
    Serial.print(",\"ax\":null,\"ay\":null,\"az\":null");
  }
  if (hasIr) {
    int ir = digitalRead(PIN_IR);
    printBit("jail", IR_ACTIVE_LOW ? !ir : ir);
  } else {
    Serial.print(",\"jail\":null");
  }
  Serial.print(",\"servo\":");
  Serial.print(hasServo ? (servoLocked ? "\"locked\"" : "\"unlocked\"") : "null");
  Serial.println("}");
  soundPeak = 0;
}

// ── Main ────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BTN, INPUT);
  pinMode(PIN_PAD, INPUT);
  pinMode(PIN_IR, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);

  Wire.begin();
  Wire.setClock(100000);
  hasAccel = i2cPresent(ADDR_ACCEL);
  if (hasAccel) mmaInit();
  hasDisplay = i2cPresent(ADDR_DISPLAY);
  if (hasDisplay) {
    display.begin(ADDR_DISPLAY);
    display.setBrightness(10);
    showText("OATH");
  }

  Serial.print("{\"boot\":\"homebase\",\"fw\":\"oath-1\",\"accel\":");
  Serial.print(hasAccel ? "true" : "false");
  Serial.print(",\"display\":");
  Serial.print(hasDisplay ? "true" : "false");
  Serial.println("}");
  playMelody(TICK, 1);
}

void loop() {
  unsigned long now = millis();
  int s = analogRead(PIN_SOUND);
  if (s > soundPeak) soundPeak = s;
  readCommands();
  updateBuzzer(now);
  if (now - lastSample >= SAMPLE_MS) {
    lastSample = now;
    sendReading(now);
  }
}
