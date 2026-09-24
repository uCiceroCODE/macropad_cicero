// Test per Arduino UNO R3 (Comunicazione Seriale)
const int BUTTON_PIN = 3;
bool lastButtonState = HIGH;

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP); // Abilita la resistenza di pull-up interna
  Serial.begin(9600); // Inizia la comunicazione seriale a 9600 baud
}

void loop() {
  bool currentState = digitalRead(BUTTON_PIN);

  // Rileva quando il pulsante viene PREMUTO (passa da HIGH a LOW)
  if (currentState == LOW && lastButtonState == HIGH) {
    // Invia un comando identificativo via Seriale al PC
    Serial.println("TASTO_1_PREMUTO");
    delay(50); // Debounce per evitare false letture
  }

  lastButtonState = currentState;
}