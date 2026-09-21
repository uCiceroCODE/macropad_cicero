/**
 * ====================================================================
 * Macro Pad Manager - Firmware per Arduino UNO R3 (Comunicazione Seriale)
 * ====================================================================
 * 
 * FASE 1: Questo sketch legge i pulsanti fisici collegati ai pin digitali
 * (configurati con INPUT_PULLUP interno) e invia stringhe seriali formattate 
 * al PC a 9600 baud (es. "BTN_1_PRESSED", "BTN_2_PRESSED", ecc.).
 *
 * Collegamento Hardware:
 * - Pin Digitale 2 -> Primo capo del Pulsante 1
 * - GND            -> Secondo capo del Pulsante 1
 * (Ripetere per ulteriori pulsanti sui pin 3, 4, 5...)
 */

// Struttura per mappare i pulsanti
struct Button {
  int pin;
  int id;
  bool lastState;
  unsigned long lastDebounceTime;
};

// Configura qui i tuoi pulsanti (Pin su Arduino, ID tasto nel programma Desktop)
Button buttons[] = {
  { 2, 1, HIGH, 0 }, // Pulsante 1 su Pin 2 (invia BTN_1_PRESSED)
  // Puoi decommentare o aggiungere altri pulsanti:
  // { 3, 2, HIGH, 0 }, // Pulsante 2 su Pin 3 (invia BTN_2_PRESSED)
  // { 4, 3, HIGH, 0 }, // Pulsante 3 su Pin 4 (invia BTN_3_PRESSED)
  // { 5, 4, HIGH, 0 }  // Pulsante 4 su Pin 5 (invia BTN_4_PRESSED)
};

const int BUTTON_COUNT = sizeof(buttons) / sizeof(buttons[0]);
const unsigned long DEBOUNCE_DELAY_MS = 50; // Tempo di antirimbalzo software

void setup() {
  // Inizializzazione della porta seriale a 9600 baud
  Serial.begin(9600);

  // Configura i pin con pull-up interno (HIGH a riposo, LOW quando premuto a GND)
  for (int i = 0; i < BUTTON_COUNT; i++) {
    pinMode(buttons[i].pin, INPUT_PULLUP);
    buttons[i].lastState = digitalRead(buttons[i].pin);
  }

  Serial.println("[MACROPAD] Firmware Arduino UNO R3 Avviato");
}

void loop() {
  unsigned long currentTime = millis();

  for (int i = 0; i < BUTTON_COUNT; i++) {
    bool currentState = digitalRead(buttons[i].pin);

    // Rileva transizione da non premuto (HIGH) a premuto (LOW)
    if (currentState == LOW && buttons[i].lastState == HIGH) {
      if ((currentTime - buttons[i].lastDebounceTime) > DEBOUNCE_DELAY_MS) {
        // Invia stringa formattata compatibile con il Desktop Listener
        Serial.print("BTN_");
        Serial.print(buttons[i].id);
        Serial.println("_PRESSED");

        buttons[i].lastDebounceTime = currentTime;
      }
    }

    buttons[i].lastState = currentState;
  }
}
