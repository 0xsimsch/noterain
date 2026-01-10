import { useEffect, useState } from 'react';
import { WebMidi, NoteMessageEvent } from 'webmidi';
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
    addSatisfiedWaitNote,
  } = useMidiStore();

  const [isWebMidiReady, setIsWebMidiReady] = useState(WebMidi.enabled);

  // Initialize WebMidi once
  useEffect(() => {
    let mounted = true;

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
      console.log('[MidiInput] Devices updated:', midiDevices.map(d => d.name));
      setDevices(midiDevices);
    }

    function autoSelectDevice() {
      const currentSelected = useMidiStore.getState().selectedInputId;
      const hardwareInputs = WebMidi.inputs.filter(
        (i) => !isVirtualDevice(i.name, i.manufacturer)
      );
      const selectedStillExists = hardwareInputs.some((i) => i.id === currentSelected);

      if (hardwareInputs.length > 0 && (!currentSelected || !selectedStillExists)) {
        console.log('[MidiInput] Auto-selecting:', hardwareInputs[0].name);
        selectInput(hardwareInputs[0].id);
      }
    }

    async function init() {
      // If already enabled, just update state
      if (WebMidi.enabled) {
        console.log('[MidiInput] WebMidi already enabled');
        updateDevices();
        autoSelectDevice();
        if (mounted) setIsWebMidiReady(true);
        return;
      }

      try {
        // Firefox needs extra time after page load to detect MIDI devices
        // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1805582
        const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
        if (isFirefox) {
          console.log('[MidiInput] Firefox detected, waiting for MIDI subsystem...');
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (!mounted) return;
        }

        console.log('[MidiInput] Enabling WebMidi...');
        await WebMidi.enable({ sysex: false });
        console.log('[MidiInput] WebMidi enabled successfully');

        if (!mounted) return;

        updateDevices();
        autoSelectDevice();
        setIsWebMidiReady(true);

        // Listen for device changes
        WebMidi.addListener('connected', () => {
          console.log('[MidiInput] Device connected');
          updateDevices();
          autoSelectDevice();
        });

        WebMidi.addListener('disconnected', () => {
          console.log('[MidiInput] Device disconnected');
          updateDevices();
        });

      } catch (err) {
        console.error('[MidiInput] WebMidi could not be enabled:', err);

        // Firefox sometimes fails on first attempt after page refresh
        // Retry once after a delay
        const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
        if (isFirefox && mounted) {
          console.log('[MidiInput] Firefox: Retrying in 1 second...');
          await new Promise((resolve) => setTimeout(resolve, 1000));
          if (!mounted) return;

          try {
            await WebMidi.enable({ sysex: false });
            console.log('[MidiInput] WebMidi enabled on retry');
            updateDevices();
            autoSelectDevice();
            setIsWebMidiReady(true);
          } catch (retryErr) {
            console.error('[MidiInput] WebMidi retry failed:', retryErr);
          }
        }
      }
    }

    init();

    // Don't disable WebMidi on cleanup - it's a singleton and should stay enabled
    return () => {
      mounted = false;
    };
  }, [setDevices, selectInput]);

  // Handle input selection and note events
  useEffect(() => {
    if (!isWebMidiReady || !selectedInputId) {
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
      setLiveNote(e.note.number, true);
      addSatisfiedWaitNote(e.note.number);
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
  }, [isWebMidiReady, selectedInputId, setLiveNote, clearLiveNotes, addSatisfiedWaitNote]);

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
    isEnabled: isWebMidiReady,
  };
}
