#include <Encoder.h>

// Quando avrai l'OLED nuovo, togli le due sbarrette '//' qui sotto:
// #include <Wire.h>
// #include <Adafruit_GFX.h>
// #include <Adafruit_SSD1306.h>

// ---------------------------- Configurazione ----------------------------
struct Button {
  uint8_t pin;
  uint8_t id;
  bool lastState;
  unsigned long lastDebounceTime;
};

// I tuoi tasti normali
Button buttons[] = {
  { 8, 1, HIGH, 0 },
  { 9, 2, HIGH, 0 }, 
  { 10, 3, HIGH, 0 }
};
const uint8_t BUTTON_COUNT = sizeof(buttons) / sizeof(buttons[0]);
const unsigned long DEBOUNCE_DELAY_MS = 50;

// Encoder Pins
const uint8_t ENCODER_PIN_A = 2;
const uint8_t ENCODER_PIN_B = 3;
const uint8_t ENCODER_BTN_PIN = 4;
Encoder encoder(ENCODER_PIN_A, ENCODER_PIN_B);
bool encoderBtnLastState = HIGH;
unsigned long encoderBtnPressStart = 0;
const unsigned long LONG_PRESS_MS = 2000;

// === BLOCCO OLED CONFIGURAZIONE (ATTUALMENTE COMMENTATO) ===
/*
#define OLED_RESET -1
Adafruit_SSD1306 display(128, 64, &Wire, OLED_RESET);
*/
// ==========================================================

// ---------------------------- Macchina a Stati ----------------------------
enum Mode { MACRO, MIXER_MENU, MIXER_ADJUST };
Mode currentMode = MACRO;

char mixerApps[5][16];
uint8_t mixerAppCount = 0;
int8_t selectedIndex = 0;

// Buffer globale per ricevere stringhe
char rxBuffer[80];
uint8_t rxIndex = 0;

// ---------------------------- Funzioni ----------------------------
void drawMenu() {
  // === BLOCCO OLED DISEGNO MENU (ATTUALMENTE COMMENTATO) ===
  /*
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  
  if (mixerAppCount == 0) {
    display.setCursor(10, 25);
    display.print(F("Caricamento App..."));
  } else {
    for (uint8_t i = 0; i < mixerAppCount; ++i) {
      if (i == selectedIndex) {
        display.setCursor(0, i * 12);
        display.print('>');
        display.setCursor(8, i * 12);
      } else {
        display.setCursor(8, i * 12);
      }
      display.print(mixerApps[i]);
    }
  }
  display.display();
  */
  // ==========================================================

  // --- Stampa temporanea su Seriale ---
  Serial.println(F("\n--- MENU MIXER ---"));
  if (mixerAppCount == 0) {
    Serial.println(F("Nessuna App caricata."));
  } else {
    for (uint8_t i = 0; i < mixerAppCount; ++i) {
      if (i == selectedIndex) Serial.print(F("-> [ "));
      else Serial.print(F("   "));
      Serial.print(mixerApps[i]);
      if (i == selectedIndex) Serial.println(F(" ]"));
      else Serial.println();
    }
  }
  Serial.println(F("------------------\n"));
}

// Analizza il comando arrivato dal PC
void parseIncoming() {
  if (strncmp(rxBuffer, "MIXER_LIST:", 11) == 0) {
    mixerAppCount = 0;
    
    // QUI C'È IL DEFAULT: Quando arriva la lista, seleziona in automatico la prima app (indice 0)
    selectedIndex = 0; 
    
    char* token = strtok(rxBuffer + 11, "|");
    while (token != NULL && mixerAppCount < 5) {
      strncpy(mixerApps[mixerAppCount], token, 15);
      mixerApps[mixerAppCount][15] = '\0';
      mixerAppCount++;
      token = strtok(NULL, "|");
    }
    
    currentMode = MIXER_MENU;
    drawMenu();
  }
}

// ---------------------------- Setup ----------------------------
void setup() {
  Serial.begin(9600);

  for (uint8_t i = 0; i < BUTTON_COUNT; ++i) {
    pinMode(buttons[i].pin, INPUT_PULLUP);
    buttons[i].lastState = digitalRead(buttons[i].pin);
  }

  pinMode(ENCODER_BTN_PIN, INPUT_PULLUP);
  encoderBtnLastState = digitalRead(ENCODER_BTN_PIN);

  // === BLOCCO OLED INIZIALIZZAZIONE (ATTUALMENTE COMMENTATO) ===
  /*
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { 
    Serial.println(F("OLED FAILED!"));
    while(true); 
  } 
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(15, 25);
  display.print(F("MacroPad Pronto!"));
  display.display();
  */
  // ==========================================================
  
  Serial.println(F("SISTEMA_AVVIATO (OLED Disattivato)"));
}

// ---------------------------- Loop ----------------------------
void loop() {
  unsigned long now = millis();

  // 1. Lettura Tasti Macro normali
  for (uint8_t i = 0; i < BUTTON_COUNT; ++i) {
    bool cur = digitalRead(buttons[i].pin);
    if (cur == LOW && buttons[i].lastState == HIGH) {
      if ((now - buttons[i].lastDebounceTime) > DEBOUNCE_DELAY_MS) {
        Serial.print(F("BTN_"));
        Serial.print(buttons[i].id);
        Serial.println(F("_PRESSED"));
        buttons[i].lastDebounceTime = now;
      }
    }
    buttons[i].lastState = cur;
  }

  // 2. Lettura Pulsante Encoder (Pressione Lunga/Corta)
  bool encBtnCur = digitalRead(ENCODER_BTN_PIN);
  if (encBtnCur == LOW && encoderBtnLastState == HIGH) { 
    encoderBtnPressStart = now;
  }
  if (encBtnCur == HIGH && encoderBtnLastState == LOW) { 
    unsigned long pressDuration = now - encoderBtnPressStart;
    
    if (pressDuration >= LONG_PRESS_MS) {
      // PRESSIONE LUNGA -> Richiedi menu Mixer
      Serial.println(F("CMD:GET_MIXER_APPS"));
      
      // === BLOCCO OLED ATTESA (ATTUALMENTE COMMENTATO) ===
      /*
      display.clearDisplay();
      display.setCursor(10, 25);
      display.print(F("Attendo PC..."));
      display.display();
      */
      // ===================================================
      
    } else {
      // PRESSIONE CORTA
      if (currentMode == MIXER_MENU && mixerAppCount > 0) {
        // Sei nel menu e hai fatto click per confermare l'app selezionata
        Serial.print(F("CMD:SELECT_APP:"));
        Serial.println(mixerApps[selectedIndex]);
        
        Serial.print(F("[INFO] Modalita' volume per: "));
        Serial.println(mixerApps[selectedIndex]);
        
        // === BLOCCO OLED REGOLAZIONE VOLUME (ATTUALMENTE COMMENTATO) ===
        /*
        display.clearDisplay();
        display.setCursor(10, 10);
        display.print(mixerApps[selectedIndex]);
        display.setCursor(10, 30);
        display.print(F("Regola Volume..."));
        display.display();
        */
        // ===============================================================
        
        currentMode = MIXER_ADJUST;
      } 
      else if (currentMode == MIXER_ADJUST) {
        // Sei nella regolazione volume e hai fatto click per uscire
        currentMode = MACRO;
        Serial.println(F("[INFO] Uscito. Tornato a Macro normali"));
        
        // === BLOCCO OLED RITORNO MACRO (ATTUALMENTE COMMENTATO) ===
        /*
        display.clearDisplay();
        display.setCursor(15, 25);
        display.print(F("MacroPad Pronto!"));
        display.display();
        */
        // ==========================================================
      } 
      else {
        // Sei in modalita' MACRO normale e fai un click rapido
        Serial.println(F("BTN_ENCODER_PRESSED"));
      }
    }
  }
  encoderBtnLastState = encBtnCur;

  // 3. Rotazione Encoder
  long newPos = encoder.read();
  static long lastPos = 0;
  
  if (newPos >= lastPos + 4 || newPos <= lastPos - 4) {
    long delta = newPos - lastPos;
    lastPos = newPos;
    
    if (currentMode == MIXER_MENU && mixerAppCount > 0) {
      // Scorri le app nel menu
      if (delta > 0) {
        selectedIndex++;
        if (selectedIndex >= mixerAppCount) selectedIndex = 0;
      } else {
        selectedIndex--;
        if (selectedIndex < 0) selectedIndex = mixerAppCount - 1;
      }
      drawMenu();
    } 
    else if (currentMode == MIXER_ADJUST) {
      // Cambia volume dell'app selezionata
      if (delta > 0) Serial.println(F("CMD:VOL_UP"));
      else Serial.println(F("CMD:VOL_DOWN"));
    }
    else {
      // Modalita' MACRO normale (cambia Volume Master di Windows)
      if (delta > 0) Serial.println(F("CMD:MASTER_VOL_UP"));
      else Serial.println(F("CMD:MASTER_VOL_DOWN"));
    }
  }

  // 4. Ricezione dati dal PC in background
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n') {
      rxBuffer[rxIndex] = '\0';
      if (rxIndex > 0) parseIncoming();
      rxIndex = 0;
    } else if (c != '\r' && rxIndex < 79) {
      rxBuffer[rxIndex++] = c;
    }
  }
}