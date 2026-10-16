// Stato del documento aperto che la barra in alto mostra: salvataggio, connessione, chi c'e'.
import { create } from 'zustand';
import type { SyncStatus } from '../grapheion/sync';

export interface Presence {
  key: number;
  name: string;
  color: string;
}

interface DocState {
  status: SyncStatus | null;
  present: Presence[];
}

export const useDocStatus = create<DocState>(() => ({ status: null, present: [] }));
