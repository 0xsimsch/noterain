import { useEffect, useRef, useState } from 'react';
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
  // Track when WebMidi is ready so note listener effect can re-run
  const [isWebMidiReady, setIsWebMidiReady] = useState(false);

  // Initialize WebMidi
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        await WebMidi.enable({ sysex: false });
        console.log('[MidiInput] WebMidi enabled successfully');

        if (!mounted) return;

        // Record devices present at startup
        initialInputIdsRef.current = new Set(WebMidi.inputs.map((i) => i.id));
        console.log('[MidiInput] Initial devices:', WebMidi.inputs.map(i => i.name));

        // Update device list
        updateDevices();

        // Signal that WebMidi is ready
        setIsWebMidiReady(true);

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
      console.log('[MidiInput] Device connected:', e.port.name, 'type:', e.port.type);
      updateDevices();

      // Auto-select newly connected hardware input devices
      if (e.port.type === 'input') {
        const isNew = !initialInputIdsRef.current?.has(e.port.id);
        const isHardware = !isVirtualDevice(e.port.name, e.port.manufacturer);
        console.log('[MidiInput] Input device - isNew:', isNew, 'isHardware:', isHardware);

        if (isNew && isHardware) {
          console.log('[MidiInput] Auto-selecting new hardware device:', e.port.name);
          selectInput(e.port.id);
        }

        // Add to known devices
        initialInputIdsRef.current?.add(e.port.id);
      }
    }

    function handleDisconnected(e: PortEvent) {
      console.log('[MidiInput] Device disconnected:', e.port.name);
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
    console.log('[MidiInput] Note listener effect - isWebMidiReady:', isWebMidiReady, 'selectedInputId:', selectedInputId);

    if (!isWebMidiReady) {
      console.log('[MidiInput] WebMidi not ready yet, skipping note listener setup');
      return;
    }

    if (!selectedInputId) {
      console.log('[MidiInput] No input selected, available inputs:', WebMidi.inputs.map(i => ({ id: i.id, name: i.name })));
      clearLiveNotes();
      return;
    }

    const input = WebMidi.getInputById(selectedInputId);
    if (!input) {
      console.log('[MidiInput] Selected input not found:', selectedInputId);
      clearLiveNotes();
      return;
    }

    console.log('[MidiInput] Listening for notes on:', input.name);

    const handleNoteOn = (e: NoteMessageEvent) => {
      console.log('[MidiInput] Note ON:', e.note.name + e.note.octave, '(', e.note.number, ') velocity:', e.note.attack);
      setLiveNote(e.note.number, true);
    };

    const handleNoteOff = (e: NoteMessageEvent) => {
      console.log('[MidiInput] Note OFF:', e.note.name + e.note.octave, '(', e.note.number, ')');
      setLiveNote(e.note.number, false);
    };

    input.addListener('noteon', handleNoteOn);
    input.addListener('noteoff', handleNoteOff);

    return () => {
      input.removeListener('noteon', handleNoteOn);
      input.removeListener('noteoff', handleNoteOff);
      clearLiveNotes();
    };
  }, [isWebMidiReady, selectedInputId, setLiveNote, clearLiveNotes]);

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
