/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactContext} from 'shared/ReactTypes';
import type {Fiber} from './ReactFiber';
import type {StackCursor} from './ReactFiberStack';
import type {ExpirationTime} from './ReactFiberExpirationTime';

export type ContextDependency<T> = {
  context: ReactContext<T>,
  observedBits: number,
  next: ContextDependency<mixed> | null,
  ...
};

import {isPrimaryRenderer} from './ReactFiberHostConfig';
import {createCursor, push, pop} from './ReactFiberStack';
import MAX_SIGNED_31_BIT_INT from './maxSigned31BitInt';
import {
  ContextProvider,
  ClassComponent,
  DehydratedFragment,
} from 'shared/ReactWorkTags';

import invariant from 'shared/invariant';
import is from 'shared/objectIs';
import {
  createUpdate,
  enqueueUpdate,
  ForceUpdate,
} from 'react-reconciler/src/ReactUpdateQueue';
import {NoWork} from './ReactFiberExpirationTime';
import {markWorkInProgressReceivedUpdate} from './ReactFiberBeginWork';
import {enableSuspenseServerRenderer} from 'shared/ReactFeatureFlags';

const valueCursor: StackCursor<mixed> = createCursor(null);

let rendererSigil;
if (__DEV__) {
  // Use this to detect multiple renderers using the same context
  rendererSigil = {};
}

let currentlyRenderingFiber: Fiber | null = null;
let lastContextDependency: ContextDependency<mixed> | null = null;
let lastContextWithAllBitsObserved: ReactContext<any> | null = null;

let isDisallowedContextReadInDEV: boolean = false;

export function resetContextDependencies(): void {
  // This is called right before React yields execution, to ensure `readContext`
  // cannot be called outside the render phase.
  currentlyRenderingFiber = null;
  lastContextDependency = null;
  lastContextWithAllBitsObserved = null;
  if (__DEV__) {
    isDisallowedContextReadInDEV = false;
  }
}

export function enterDisallowedContextReadInDEV(): void {
  if (__DEV__) {
    isDisallowedContextReadInDEV = true;
  }
}

export function exitDisallowedContextReadInDEV(): void {
  if (__DEV__) {
    isDisallowedContextReadInDEV = false;
  }
}

export function pushProvider<T>(providerFiber: Fiber, nextValue: T): void {
  const context: ReactContext<T> = providerFiber.type._context;

  if (isPrimaryRenderer) {
    push(valueCursor, context._currentValue, providerFiber);

    context._currentValue = nextValue;
    if (__DEV__) {
      if (
        context._currentRenderer !== undefined &&
        context._currentRenderer !== null &&
        context._currentRenderer !== rendererSigil
      ) {
        console.error(
          'Detected multiple renderers concurrently rendering the ' +
            'same context provider. This is currently unsupported.',
        );
      }
      context._currentRenderer = rendererSigil;
    }
  } else {
    push(valueCursor, context._currentValue2, providerFiber);

    context._currentValue2 = nextValue;
    if (__DEV__) {
      if (
        context._currentRenderer2 !== undefined &&
        context._currentRenderer2 !== null &&
        context._currentRenderer2 !== rendererSigil
      ) {
        console.error(
          'Detected multiple renderers concurrently rendering the ' +
            'same context provider. This is currently unsupported.',
        );
      }
      context._currentRenderer2 = rendererSigil;
    }
  }
}

export function popProvider(providerFiber: Fiber): void {
  const currentValue = valueCursor.current;

  pop(valueCursor, providerFiber);

  const context: ReactContext<any> = providerFiber.type._context;
  if (isPrimaryRenderer) {
    context._currentValue = currentValue;
  } else {
    context._currentValue2 = currentValue;
  }
}

export function calculateChangedBits<T>(
  context: ReactContext<T>,
  newValue: T,
  oldValue: T,
) {
  if (is(oldValue, newValue)) {
    // No change
    return 0;
  } else {
    const changedBits =
      typeof context._calculateChangedBits === 'function'
        ? context._calculateChangedBits(oldValue, newValue)
        : MAX_SIGNED_31_BIT_INT;

    if (__DEV__) {
      if ((changedBits & MAX_SIGNED_31_BIT_INT) !== changedBits) {
        console.error(
          'calculateChangedBits: Expected the return value to be a ' +
            '31-bit integer. Instead received: %s',
          changedBits,
        );
      }
    }
    return changedBits | 0;
  }
}

export function scheduleWorkOnParentPath(
  parent: Fiber | null,
  renderExpirationTime: ExpirationTime,
) {
  // Update the child expiration time of all the ancestors, including
  // the alternates.
  let node = parent;
  while (node !== null) {
    let alternate = node.alternate;
    if (node.childExpirationTime < renderExpirationTime) {
      node.childExpirationTime = renderExpirationTime;
      if (
        alternate !== null &&
        alternate.childExpirationTime < renderExpirationTime
      ) {
        alternate.childExpirationTime = renderExpirationTime;
      }
    } else if (
      alternate !== null &&
      alternate.childExpirationTime < renderExpirationTime
    ) {
      alternate.childExpirationTime = renderExpirationTime;
    } else {
      // Neither alternate was updated, which means the rest of the
      // ancestor path already has sufficient priority.
      break;
    }
    node = node.return;
  }
}

export function propagateContextChange(
  workInProgress: Fiber,
  context: ReactContext<mixed>,
  changedBits: number,
  renderExpirationTime: ExpirationTime,
): void {
  let fiber = workInProgress.child;
  if (fiber !== null) {
    // Set the return pointer of the child to the work-in-progress fiber.
    fiber.return = workInProgress;
  }
  while (fiber !== null) {
    let nextFiber;

    // Visit this fiber.
    const list = fiber.dependencies;
    if (list !== null) {
      nextFiber = fiber.child;

      let dependency = list.firstContext;
      while (dependency !== null) {
        // Check if the context matches.
        if (
          dependency.context === context &&
          (dependency.observedBits & changedBits) !== 0
        ) {
          // Match! Schedule an update on this fiber.

          if (fiber.tag === ClassComponent) {
            // Schedule a force update on the work-in-progress.
            const update = createUpdate(renderExpirationTime, null);
            update.tag = ForceUpdate;
            // TODO: Because we don't have a work-in-progress, this will add the
            // update to the current fiber, too, which means it will persist even if
            // this render is thrown away. Since it's a race condition, not sure it's
            // worth fixing.
            enqueueUpdate(fiber, update);
          }

          if (fiber.expirationTime < renderExpirationTime) {
            fiber.expirationTime = renderExpirationTime;
          }
          let alternate = fiber.alternate;
          if (
            alternate !== null &&
            alternate.expirationTime < renderExpirationTime
          ) {
            alternate.expirationTime = renderExpirationTime;
          }

          scheduleWorkOnParentPath(fiber.return, renderExpirationTime);

          // Mark the expiration time on the list, too.
          if (list.expirationTime < renderExpirationTime) {
            list.expirationTime = renderExpirationTime;
          }

          // Since we already found a match, we can stop traversing the
          // dependency list.
          break;
        }
        dependency = dependency.next;
      }
    } else if (fiber.tag === ContextProvider) {
      // Don't scan deeper if this is a matching provider
      nextFiber = fiber.type === workInProgress.type ? null : fiber.child;
    } else if (
      enableSuspenseServerRenderer &&
      fiber.tag === DehydratedFragment
    ) {
      // If a dehydrated suspense bounudary is in this subtree, we don't know
      // if it will have any context consumers in it. The best we can do is
      // mark it as having updates.
      let parentSuspense = fiber.return;
      invariant(
        parentSuspense !== null,
        'We just came from a parent so we must have had a parent. This is a bug in React.',
      );
      if (parentSuspense.expirationTime < renderExpirationTime) {
        parentSuspense.expirationTime = renderExpirationTime;
      }
      let alternate = parentSuspense.alternate;
      if (
        alternate !== null &&
        alternate.expirationTime < renderExpirationTime
      ) {
        alternate.expirationTime = renderExpirationTime;
      }
      // This is intentionally passing this fiber as the parent
      // because we want to schedule this fiber as having work
      // on its children. We'll use the childExpirationTime on
      // this fiber to indicate that a context has changed.
      scheduleWorkOnParentPath(parentSuspense, renderExpirationTime);
      nextFiber = fiber.sibling;
    } else {
      // Traverse down.
      nextFiber = fiber.child;
    }

    if (nextFiber !== null) {
      // Set the return pointer of the child to the work-in-progress fiber.
      nextFiber.return = fiber;
    } else {
      // No child. Traverse to next sibling.
      nextFiber = fiber;
      while (nextFiber !== null) {
        if (nextFiber === workInProgress) {
          // We're back to the root of this subtree. Exit.
          nextFiber = null;
          break;
        }
        let sibling = nextFiber.sibling;
        if (sibling !== null) {
          // Set the return pointer of the sibling to the work-in-progress fiber.
          sibling.return = nextFiber.return;
          nextFiber = sibling;
          break;
        }
        // No more siblings. Traverse up.
        nextFiber = nextFiber.return;
      }
    }
    fiber = nextFiber;
  }
}

export function prepareToReadContext(
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
): void {
  currentlyRenderingFiber = workInProgress;
  lastContextDependency = null;
  lastContextWithAllBitsObserved = null;

  const dependencies = workInProgress.dependencies;
  if (dependencies !== null) {
    const firstContext = dependencies.firstContext;
    if (firstContext !== null) {
      if (dependencies.expirationTime >= renderExpirationTime) {
        // Context list has a pending update. Mark that this fiber performed work.
        markWorkInProgressReceivedUpdate();
      }
      // Reset the work-in-progress list
      dependencies.firstContext = null;
    }
  }
}

export function readContext<T>(
  context: ReactContext<T>,
  observedBits: void | number | boolean,
): T {
  if (__DEV__) {
    // This warning would fire if you read context inside a Hook like useMemo.
    // Unlike the class check below, it's not enforced in production for perf.
    if (isDisallowedContextReadInDEV) {
      console.error(
        'Context can only be read while React is rendering. ' +
          'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
          'In function components, you can read it directly in the function body, but not ' +
          'inside Hooks like useReducer() or useMemo().',
      );
    }
  }

  if (lastContextWithAllBitsObserved === context) {
    // Nothing to do. We already observe everything in this context.
  } else if (observedBits === false || observedBits === 0) {
    // Do not observe any updates.
  } else {
    let resolvedObservedBits; // Avoid deopting on observable arguments or heterogeneous types.
    if (
      typeof observedBits !== 'number' ||
      observedBits === MAX_SIGNED_31_BIT_INT
    ) {
      // Observe all updates.
      lastContextWithAllBitsObserved = ((context: any): ReactContext<mixed>);
      resolvedObservedBits = MAX_SIGNED_31_BIT_INT;
    } else {
      resolvedObservedBits = observedBits;
    }

    let contextItem = {
      context: ((context: any): ReactContext<mixed>),
      observedBits: resolvedObservedBits,
      next: null,
    };

    if (lastContextDependency === null) {
      invariant(
        currentlyRenderingFiber !== null,
        'Context can only be read while React is rendering. ' +
          'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
          'In function components, you can read it directly in the function body, but not ' +
          'inside Hooks like useReducer() or useMemo().',
      );

      // This is the first dependency for this component. Create a new list.
      lastContextDependency = contextItem;
      currentlyRenderingFiber.dependencies = {
        expirationTime: NoWork,
        firstContext: contextItem,
        responders: null,
      };
    } else {
      // Append a new context item.
      lastContextDependency = lastContextDependency.next = contextItem;
    }
  }
  return isPrimaryRenderer ? context._currentValue : context._currentValue2;
}
