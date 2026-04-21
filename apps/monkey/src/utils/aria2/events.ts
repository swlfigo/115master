import mitt from 'mitt'

interface Events {
  'aria2:open-settings': void
}

export const aria2Events = mitt<Events>()
