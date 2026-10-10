'use client';

import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { RoomConnection } from './connection';

/** Subscribe a component tree to one room's confirmed state. */
export function useRoom(roomId: string) {
  const [connection] = useState(() => new RoomConnection(roomId));
  useEffect(() => {
    connection.start();
    return () => connection.stop();
  }, [connection]);
  const state = useStore(connection.store);
  return { ...state, connection };
}
