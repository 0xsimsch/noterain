import { useEffect, useRef } from 'react';
import { WebMidi, NoteMessageEvent, PortEvent } from 'webmidi';
import { useMidiStore } from '../stores/midiStore';
import type { MidiDevice } from '../types/midi';

/** Patterns that indicate virtual/software MIDI devices */
const VIRTUAL_DEVICE_PATTERNS = [
  /midi through/i,
  /iac driver/i,
  /loopbe/i,
  /loopmidi/i,
  /virtual/i,
  /microsoft gs/i,
  /wavetable/i,
  /synth/i,
  /rtpmidi/i,
  /network/i,
  /bus/i,
  /webmidi/i,
  /^output$/i,
];

/** Check if a device is likely a virtual/software MIDI device */
function isVirtualDevice(name: string, manufacturer: string): boolean {
  const combined = `${name} ${manufacturer}`.toLowerCase();
  return VIRTUAL_DEVICE_PATTERNS.some((pattern) => pattern.test(combined));
}

/** Hook for connecting to MIDI devices */
export function useMidiInput() {
  const {
    devices,
    setDevices,
    selectedInputId,
    selectInput,
    setLiveNote,
    clearLiveNotes,
  } = useMidiStore();

  // Track device IDs present at startup (to detect newly connected ones)
  const initialInputIdsRef = useRef<Set<string> | null>(null);

  // Initialize WebMidi
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        await WebMidi.enable({ sysex: false });

        if (!mounted) return;

        // Record devices present at startup
        initialInputIdsRef.current = new Set(WebMidi.inputs.map((i) => i.id));

        // Update device list
        updateDevices();

        // Listen for device changes
        WebMidi.addListener('connected', handleConnected);
        WebMidi.addListener('disconnected', handleDisconnected);
      } catch (err) {
        console.error('WebMidi could not be enabled:', err);
      }
    }

    function updateDevices() {
      const midiDevices: MidiDevice[] = [
        ...WebMidi.inputs.map((input) => ({
          id: input.id,
          name: input.name,
          manufacturer: input.manufacturer,
          type: 'input' as const,
          connected: true,
        })),
        ...WebMidi.outputs.map((output) => ({
          id: output.id,
          name: output.name,
          manufacturer: output.manufacturer,
          type: 'output' as const,
          connected: true,
        })),
      ];
      setDevices(midiDevices);
    }

    function handleConnected(e: PortEvent) {
      updateDevices();

      // Auto-select newly connected hardware input devices
      if (e.port.type === 'input') {
        const isNew = !initialInputIdsRef.current?.has(e.port.id);
        const isHardware = !isVirtualDevice(e.port.name, e.port.manufacturer);

        if (isNew && isHardware) {
          selectInput(e.port.id);
        }

        // Add to known devices
        initialInputIdsRef.current?.add(e.port.id);
      }
    }

    function handleDisconnected(e: PortEvent) {
      updateDevices();

      if (e.port.type === 'input') {
        // If disconnected device was selected, try to select another hardware device
        const currentSelected = useMidiStore.getState().selectedInputId;
        if (currentSelected === e.port.id) {
          const hardwareInput = WebMidi.inputs.find(
            (i) => !isVirtualDevice(i.name, i.manufacturer)
          );
          selectInput(hardwareInput?.id || null);
        }
      }
    }

    init();

    return () => {
      mounted = false;
      if (WebMidi.enabled) {
        WebMidi.removeListener('connected', handleConnected);
        WebMidi.removeListener('disconnected', handleDisconnected);
      }
    };
  }, [setDevices, selectInput]);

  // Handle input selection and note events
  useEffect(() => {
    if (!WebMidi.enabled || !selectedInputId) {
      clearLiveNotes();
      return;
    }

    const input = WebMidi.getInputById(selectedInputId);
    if (!input) {
      clearLiveNotes();
      return;
    }

    const handleNoteOn = (e: NoteMessageEvent) => {
      setLiveNote(e.note.number, true);
    };

    const handleNoteOff = (e: NoteMessageEvent) => {
      setLiveNote(e.note.number, false);
    };

    input.addListener('noteon', handleNoteOn);
    input.addListener('noteoff', handleNoteOff);

    return () => {
      input.removeListener('noteon', handleNoteOn);
      input.removeListener('noteoff', handleNoteOff);
      clearLiveNotes();
    };
  }, [selectedInputId, setLiveNote, clearLiveNotes]);

  // Get available inputs (filter out virtual devices)
  const inputs = devices.filter(
    (d) => d.type === 'input' && !isVirtualDevice(d.name, d.manufacturer)
  );
  const outputs = devices.filter(
    (d) => d.type === 'output' && !isVirtualDevice(d.name, d.manufacturer)
  );

  const selectedInput = inputs.find((d) => d.id === selectedInputId);

  return {
    inputs,
    outputs,
    selectedInput,
    selectInput,
    isEnabled: WebMidi.enabled,
  };
}
