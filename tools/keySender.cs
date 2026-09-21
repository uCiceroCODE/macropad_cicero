using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace KeySender
{
    class Program
    {
        [StructLayout(LayoutKind.Sequential)]
        struct INPUT
        {
            public uint type;
            public InputUnion u;
        }

        [StructLayout(LayoutKind.Explicit)]
        struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
            [FieldOffset(0)] public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)]
        struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }

        const uint INPUT_KEYBOARD = 1;
        const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        const uint KEYEVENTF_KEYUP = 0x0002;
        const uint KEYEVENTF_UNICODE = 0x0004;
        const uint KEYEVENTF_SCANCODE = 0x0008;

        [DllImport("user32.dll", SetLastError = true)]
        static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        static readonly Dictionary<string, ushort> KeyMap = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase)
        {
            // Modificatori
            { "CTRL", 0x11 }, { "CONTROL", 0x11 }, { "LCTRL", 0xA2 }, { "RCTRL", 0xA3 },
            { "ALT", 0x12 }, { "LALT", 0xA4 }, { "RALT", 0xA5 },
            { "SHIFT", 0x10 }, { "LSHIFT", 0xA0 }, { "RSHIFT", 0xA1 },
            { "WIN", 0x5B }, { "LWIN", 0x5B }, { "RWIN", 0x5C },

            // Tasti comuni
            { "ENTER", 0x0D }, { "RETURN", 0x0D },
            { "ESC", 0x1B }, { "ESCAPE", 0x1B },
            { "TAB", 0x09 },
            { "SPACE", 0x20 },
            { "BACKSPACE", 0x08 }, { "BKSP", 0x08 },
            { "DELETE", 0x2E }, { "DEL", 0x2E },
            { "INSERT", 0x2D }, { "INS", 0x2D },
            { "HOME", 0x24 },
            { "END", 0x23 },
            { "PAGEUP", 0x21 }, { "PGUP", 0x21 },
            { "PAGEDOWN", 0x22 }, { "PGDN", 0x22 },
            { "UP", 0x26 }, { "DOWN", 0x28 }, { "LEFT", 0x25 }, { "RIGHT", 0x27 },
            { "CAPSLOCK", 0x14 }, { "NUMLOCK", 0x90 }, { "SCROLLLOCK", 0x91 },
            { "PRINTSCREEN", 0x2C }, { "PRTSC", 0x2C }, { "PAUSE", 0x13 },

            // Tasti funzione
            { "F1", 0x70 }, { "F2", 0x71 }, { "F3", 0x72 }, { "F4", 0x73 },
            { "F5", 0x74 }, { "F6", 0x75 }, { "F7", 0x76 }, { "F8", 0x77 },
            { "F9", 0x78 }, { "F10", 0x79 }, { "F11", 0x7A }, { "F12", 0x7B },
            { "F13", 0x7C }, { "F14", 0x7D }, { "F15", 0x7E }, { "F16", 0x7F },
            { "F17", 0x80 }, { "F18", 0x81 }, { "F19", 0x82 }, { "F20", 0x83 },
            { "F21", 0x84 }, { "F22", 0x85 }, { "F23", 0x86 }, { "F24", 0x87 },

            // Tasti multimediali
            { "VOLUME_MUTE", 0xAD }, { "MUTE", 0xAD },
            { "VOLUME_DOWN", 0xAE }, { "VOLDOWN", 0xAE },
            { "VOLUME_UP", 0xAF }, { "VOLUP", 0xAF },
            { "MEDIA_NEXT_TRACK", 0xB0 }, { "NEXTTRACK", 0xB0 },
            { "MEDIA_PREV_TRACK", 0xB1 }, { "PREVTRACK", 0xB1 },
            { "MEDIA_STOP", 0xB2 },
            { "MEDIA_PLAY_PAUSE", 0xB3 }, { "PLAYPAUSE", 0xB3 }
        };

        static void Main(string[] args)
        {
            if (args.Length < 2)
            {
                Console.WriteLine("Uso: keySender.exe [--text \"stringa\"] | [--combo \"ctrl+c\"] | [--key \"F13\"]");
                return;
            }

            string mode = args[0].ToLowerInvariant();
            string value = args[1];

            switch (mode)
            {
                case "--text":
                    SendUnicodeText(value);
                    break;
                case "--combo":
                    SendKeyCombo(value);
                    break;
                case "--key":
                    SendSingleKey(value);
                    break;
                default:
                    Console.Error.WriteLine("Modalità non supportata: " + mode);
                    break;
            }
        }

        static void SendUnicodeText(string text)
        {
            List<INPUT> inputs = new List<INPUT>();
            foreach (char c in text)
            {
                INPUT down = new INPUT
                {
                    type = INPUT_KEYBOARD,
                    u = new InputUnion
                    {
                        ki = new KEYBDINPUT
                        {
                            wScan = c,
                            dwFlags = KEYEVENTF_UNICODE
                        }
                    }
                };
                INPUT up = new INPUT
                {
                    type = INPUT_KEYBOARD,
                    u = new InputUnion
                    {
                        ki = new KEYBDINPUT
                        {
                            wScan = c,
                            dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
                        }
                    }
                };
                inputs.Add(down);
                inputs.Add(up);
            }

            SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT)));
        }

        static void SendKeyCombo(string comboStr)
        {
            string[] parts = comboStr.Split(new[] { '+', ' ' }, StringSplitOptions.RemoveEmptyEntries);
            List<ushort> vkCodes = new List<ushort>();

            foreach (var part in parts)
            {
                ushort vk = ResolveVk(part);
                if (vk != 0) vkCodes.Add(vk);
            }

            if (vkCodes.Count == 0) return;

            List<INPUT> inputs = new List<INPUT>();

            // Premi tutti i tasti in sequenza
            for (int i = 0; i < vkCodes.Count; i++)
            {
                inputs.Add(new INPUT
                {
                    type = INPUT_KEYBOARD,
                    u = new InputUnion
                    {
                        ki = new KEYBDINPUT { wVk = vkCodes[i], dwFlags = 0 }
                    }
                });
            }

            // Rilascia in ordine inverso
            for (int i = vkCodes.Count - 1; i >= 0; i--)
            {
                inputs.Add(new INPUT
                {
                    type = INPUT_KEYBOARD,
                    u = new InputUnion
                    {
                        ki = new KEYBDINPUT { wVk = vkCodes[i], dwFlags = KEYEVENTF_KEYUP }
                    }
                });
            }

            SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT)));
        }

        static void SendSingleKey(string keyName)
        {
            ushort vk = ResolveVk(keyName);
            if (vk == 0) return;

            INPUT[] inputs = new INPUT[2];
            inputs[0] = new INPUT
            {
                type = INPUT_KEYBOARD,
                u = new InputUnion { ki = new KEYBDINPUT { wVk = vk, dwFlags = 0 } }
            };
            inputs[1] = new INPUT
            {
                type = INPUT_KEYBOARD,
                u = new InputUnion { ki = new KEYBDINPUT { wVk = vk, dwFlags = KEYEVENTF_KEYUP } }
            };

            SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        static ushort ResolveVk(string keyName)
        {
            string clean = keyName.Trim().ToUpperInvariant();
            if (KeyMap.ContainsKey(clean)) return KeyMap[clean];

            // Singola lettera o numero A-Z, 0-9
            if (clean.Length == 1)
            {
                char ch = clean[0];
                if ((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9'))
                {
                    return (ushort)ch;
                }
            }

            return 0;
        }
    }
}
