import { Context } from '@datadog/browser-core'
import { setup, TestSetupBuilder } from '../../test/specHelper'
import { RumEventCategory } from '../types'
import { RawRumEventV2, RumEventType } from '../typesV2'
import { LifeCycle, LifeCycleEventType } from './lifeCycle'

interface ServerRumEvents {
  application: {
    id: string
  }
  action: {
    id: string
  }
  context: any
  date: number
  type: string
  session: {
    id: string
  }
  view: {
    id: string
    referrer: string
    url: string
  }
  long_task?: {
    duration: number
  }
  _dd: {
    format_version: 2
  }
}

describe('rum assembly v2', () => {
  let setupBuilder: TestSetupBuilder
  let lifeCycle: LifeCycle
  let setGlobalContext: (context: Context) => void
  let serverRumEvents: ServerRumEvents[]
  let isTracked: boolean

  function generateRawRumEvent(
    type: RumEventType,
    properties?: Partial<RawRumEventV2>,
    savedGlobalContext?: Context,
    customerContext?: Context
  ) {
    const event = { type, ...properties }
    lifeCycle.notify(LifeCycleEventType.RAW_RUM_EVENT_V2_COLLECTED, {
      customerContext,
      savedGlobalContext,
      rawRumEvent: event as RawRumEventV2,
      startTime: 0,
    })
  }

  beforeEach(() => {
    isTracked = true
    setupBuilder = setup()
      .withSession({
        getId: () => '1234',
        isTracked: () => isTracked,
        isTrackedWithResource: () => true,
      })
      .withParentContexts({
        findActionV2: () => ({
          action: {
            id: '7890',
          },
        }),
        findViewV2: () => ({
          session: {
            id: '1234',
          },
          view: {
            id: 'abcde',
            referrer: 'url',
            url: 'url',
          },
        }),
      })
      .withAssemblyV2()
    ;({ lifeCycle, setGlobalContext } = setupBuilder.build())

    serverRumEvents = []
    lifeCycle.subscribe(LifeCycleEventType.RUM_EVENT_V2_COLLECTED, ({ serverRumEvent }) =>
      serverRumEvents.push((serverRumEvent as unknown) as ServerRumEvents)
    )
  })

  afterEach(() => {
    setupBuilder.cleanup()
  })

  describe('events', () => {
    it('should have snake cased attributes', () => {
      generateRawRumEvent(RumEventType.LONG_TASK, { longTask: { duration: 2 } })

      expect(serverRumEvents[0].long_task!.duration).toBe(2)
    })
  })

  describe('rum context', () => {
    it('should be merged with event attributes', () => {
      generateRawRumEvent(RumEventType.VIEW)

      expect(serverRumEvents[0].view.id).toBeDefined()
      expect(serverRumEvents[0].date).toBeDefined()
    })

    it('should be snake cased', () => {
      generateRawRumEvent(RumEventType.VIEW)

      expect(serverRumEvents[0]._dd.format_version).toBe(2)
    })

    it('should be overwritten by event attributes', () => {
      generateRawRumEvent(RumEventType.VIEW, { date: 10 })

      expect(serverRumEvents[0].date).toBe(10)
    })
  })

  describe('rum global context', () => {
    it('should be merged with event attributes', () => {
      setGlobalContext({ bar: 'foo' })
      generateRawRumEvent(RumEventType.VIEW)

      expect((serverRumEvents[0].context as any).bar).toEqual('foo')
    })

    it('should ignore subsequent context mutation', () => {
      const globalContext = { bar: 'foo' }
      setGlobalContext(globalContext)
      generateRawRumEvent(RumEventType.VIEW)
      delete globalContext.bar
      generateRawRumEvent(RumEventType.VIEW)

      expect((serverRumEvents[0].context as any).bar).toEqual('foo')
      expect((serverRumEvents[1].context as any).bar).toBeUndefined()
    })

    it('should not be automatically snake cased', () => {
      setGlobalContext({ fooBar: 'foo' })
      generateRawRumEvent(RumEventType.VIEW)

      expect((serverRumEvents[0].context as any).fooBar).toEqual('foo')
    })

    it('should ignore the current global context when a saved global context is provided', () => {
      setGlobalContext({ replacedContext: 'b', addedContext: 'x' })

      generateRawRumEvent(RumEventType.VIEW, undefined, { replacedContext: 'a' })

      expect((serverRumEvents[0].context as any).replacedContext).toEqual('a')
      expect((serverRumEvents[0].context as any).addedContext).toEqual(undefined)
    })
  })

  describe('customer context', () => {
    it('should be merged with event attributes', () => {
      generateRawRumEvent(RumEventType.VIEW, undefined, undefined, { foo: 'bar' })

      expect((serverRumEvents[0].context as any).foo).toEqual('bar')
    })

    it('should not be automatically snake cased', () => {
      generateRawRumEvent(RumEventType.VIEW, undefined, undefined, { fooBar: 'foo' })

      expect((serverRumEvents[0].context as any).fooBar).toEqual('foo')
    })
  })

  describe('action context', () => {
    it('should be added on some event categories', () => {
      ;[RumEventType.RESOURCE, RumEventType.LONG_TASK, RumEventType.ERROR].forEach((category) => {
        generateRawRumEvent(category)
        expect(serverRumEvents[0].action.id).toBeDefined()
        serverRumEvents = []
      })
      ;[RumEventType.VIEW, RumEventType.ACTION].forEach((category) => {
        generateRawRumEvent(category)
        expect(serverRumEvents[0].action).not.toBeDefined()
        serverRumEvents = []
      })
    })
  })

  describe('view context', () => {
    it('should be merged with event attributes', () => {
      generateRawRumEvent(RumEventType.ACTION)
      expect(serverRumEvents[0].view).toEqual({
        id: 'abcde',
        referrer: 'url',
        url: 'url',
      })
      expect(serverRumEvents[0].session.id).toBe('1234')
    })
  })

  describe('session', () => {
    it('when tracked, it should generate event ', () => {
      isTracked = true

      generateRawRumEvent(RumEventType.VIEW)
      expect(serverRumEvents.length).toBe(1)
    })

    it('when not tracked, it should not generate event ', () => {
      isTracked = false

      generateRawRumEvent(RumEventType.VIEW)
      expect(serverRumEvents.length).toBe(0)
    })
  })
})
