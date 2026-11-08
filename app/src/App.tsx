import { useState } from 'react'
import Home from './screens/Home'
import Live from './screens/Live'
import NewPack from './screens/NewPack'
import PackDetail from './screens/PackDetail'
import Stage from './screens/Stage'

export type View =
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'pack'; id: string }
  | { name: 'live'; packId: string }
  | { name: 'stage'; packId: string; songId: string; record: boolean }

export default function App() {
  const [view, setView] = useState<View>({ name: 'home' })

  switch (view.name) {
    case 'home':
      return <Home onOpen={(id) => setView({ name: 'pack', id })} onCreate={() => setView({ name: 'new' })} />
    case 'new':
      return <NewPack onCancel={() => setView({ name: 'home' })} onDone={(id) => setView({ name: 'pack', id })} />
    case 'pack':
      return (
        <PackDetail
          packId={view.id}
          onBack={() => setView({ name: 'home' })}
          onLive={() => setView({ name: 'live', packId: view.id })}
          onSing={(songId) => setView({ name: 'stage', packId: view.id, songId, record: false })}
        />
      )
    case 'live':
      return (
        <Live
          packId={view.packId}
          onExit={() => setView({ name: 'pack', id: view.packId })}
          onSing={(songId) => setView({ name: 'stage', packId: view.packId, songId, record: true })}
        />
      )
    case 'stage':
      return (
        <Stage
          packId={view.packId}
          songId={view.songId}
          record={view.record}
          onExit={() => setView({ name: 'pack', id: view.packId })}
          onSwitch={(songId) => setView({ name: 'stage', packId: view.packId, songId, record: true })}
        />
      )
  }
}
