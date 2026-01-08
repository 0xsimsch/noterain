import { useEffect, useRef, useState } from 'react';
import { WebMidi, NoteMessageEvent, PortEvent } from 'webmidi';
import { useMidiStore } from '../stores/midiStore';
import type { MidiDevice } from '../types/midi';

/** Track if MIDI permission was denied this session (resets on page refresh) */
let midiPermissionDenied = false;

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

  // Track device IDs present at startup (to detect newly connected ones)
  const initialInputIdsRef = useRef<Set<string> | null>(null);
  // Track when WebMidi is ready so note listener effect can re-run
  const [isWebMidiReady, setIsWebMidiReady] = useState(false);

  // Initialize WebMidi
  useEffect(() => {
    let mounted = true;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    async function init() {
      // Don't request permission again if already denied this session
      if (midiPermissionDenied) {
        console.log('[MidiInput] MIDI permission was denied, skipping init until page refresh');
        return;
      }

      try {
        // Ensure WebMidi is disabled before enabling (Firefox workaround)
        if (WebMidi.enabled) {
          await WebMidi.disable();
        }

        // Small delay to let browser settle after page load (Firefox workaround)
        await new Promise((resolve) => setTimeout(resolve, 100));

        if (!mounted) return;

        await WebMidi.enable({ sysex: false });
        console.log('[MidiInput] WebMidi enabled successfully');

        if (!mounted) return;

        // Record devices present at startup
        initialInputIdsRef.current = new Set(WebMidi.inputs.map((i) => i.id));
        console.log('[MidiInput] Initial devices:', WebMidi.inputs.map(i => i.name));

        // Update device list
        updateDevices();

        // Auto-select first hardware device if none selected or selected device not found
        const currentSelected = useMidiStore.getState().selectedInputId;
        const hardwareInputs = getHardwareInputs();
        const selectedStillExists = hardwareInputs.some((i) => i.id === currentSelected);

        if (hardwareInputs.length > 0 && (!currentSelected || !selectedStillExists)) {
          console.log('[MidiInput] Auto-selecting hardware device:', hardwareInputs[0].name);
          selectInput(hardwareInputs[0].id);
        }

        // Signal that WebMidi is ready
        setIsWebMidiReady(true);

        // Listen for device changes
        WebMidi.addListener('connected', handleConnected);
        WebMidi.addListener('disconnected', handleDisconnected);

        // Start polling if no hardware devices found
        startPollingIfNeeded();
      } catch (err) {
        console.error('WebMidi could not be enabled:', err);
        // Check if this is a permission denial (NotAllowedError or SecurityError)
        const errorName = err instanceof Error ? err.name : '';
        if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
          console.log('[MidiInput] MIDI permission denied by user, will not ask again until page refresh');
          midiPermissionDenied = true;
          return;
        }
        // Retry after a delay for other errors (Firefox sometimes needs this)
        if (mounted) {
          console.log('[MidiInput] Retrying WebMidi init in 1 second...');
          setTimeout(init, 1000);
        }
      }
    }

    function getHardwareInputs() {
      const all = WebMidi.inputs;
      const hardware = all.filter(
        (i) => !isVirtualDevice(i.name, i.manufacturer)
      );
      console.log('[MidiInput] All inputs:', all.map(i => i.name), 'Hardware:', hardware.map(i => i.name));
      return hardware;
    }

    async function pollForDevices() {
      if (!mounted) return;

      // Don't poll if permission was denied
      if (midiPermissionDenied) {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        return;
      }

      try {
        console.log('[MidiInput] Polling for MIDI devices...');
        // Use native API to get fresh device list
        const midiAccess = await navigator.requestMIDIAccess({ sysex: false });
        const inputs = Array.from(midiAccess.inputs.values());
        const hardwareInputs = inputs.filter(
          (i) => !isVirtualDevice(i.name || '', i.manufacturer || '')
        );
        console.log('[MidiInput] Poll found', inputs.length, 'inputs,', hardwareInputs.length, 'hardware');

        if (hardwareInputs.length > 0) {
          console.log('[MidiInput] Hardware devices detected via polling:', hardwareInputs.map(i => i.name));
          // Re-enable WebMidi to refresh its internal state
          if (WebMidi.enabled) {
            await WebMidi.disable();
          }
          await WebMidi.enable({ sysex: false });

          // Re-attach event listeners
          WebMidi.addListener('connected', handleConnected);
          WebMidi.addListener('disconnected', handleDisconnected);

          // Update initial device IDs
          initialInputIdsRef.current = new Set(WebMidi.inputs.map((i) => i.id));

          updateDevices();

          // Stop polling
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        }
      } catch (err) {
        console.error('[MidiInput] Error polling for devices:', err);
      }
    }

    function startPollingIfNeeded() {
      // Clear any existing poll interval
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }

      // If we have hardware inputs, no need to poll
      if (getHardwareInputs().length > 0) {
        console.log('[MidiInput] Hardware devices found, polling not needed');
        return;
      }

      // Poll every 2 seconds for new devices
      console.log('[MidiInput] No hardware devices found, starting polling');
      pollInterval = setInterval(pollForDevices, 2000);
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

        // Resume polling if no hardware devices remain
        startPollingIfNeeded();
      }
    }

    init();

    return () => {
      mounted = false;
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (WebMidi.enabled) {
        WebMidi.removeListener('connected', handleConnected);
        WebMidi.removeListener('disconnected', handleDisconnected);
        // Disable WebMidi on cleanup to ensure fresh state on next init
        WebMidi.disable();
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
      addSatisfiedWaitNote(e.note.number);
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
    isEnabled: WebMidi.enabled,
  };
}
