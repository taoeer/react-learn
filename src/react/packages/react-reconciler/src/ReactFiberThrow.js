/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactFiber';
import type {FiberRoot} from './ReactFiberRoot';
import type {ExpirationTime} from './ReactFiberExpirationTime';
import type {CapturedValue} from './ReactCapturedValue';
import type {Update} from './ReactUpdateQueue';
import type {Thenable} from './ReactFiberWorkLoop';
import type {SuspenseContext} from './ReactFiberSuspenseContext';

import getComponentName from 'shared/getComponentName';
import {
  ClassComponent,
  HostRoot,
  SuspenseComponent,
  IncompleteClassComponent,
} from 'shared/ReactWorkTags';
import {
  DidCapture,
  Incomplete,
  NoEffect,
  ShouldCapture,
  LifecycleEffectMask,
} from 'shared/ReactSideEffectTags';
import {NoMode, BlockingMode} from './ReactTypeOfMode';
import {shouldCaptureSuspense} from './ReactFiberSuspenseComponent';

import {createCapturedValue} from './ReactCapturedValue';
import {
  enqueueCapturedUpdate,
  createUpdate,
  CaptureUpdate,
  ForceUpdate,
  enqueueUpdate,
} from './ReactUpdateQueue';
import {logError} from './ReactFiberCommitWork';
import {getStackByFiberInDevAndProd} from './ReactCurrentFiber';
import {markFailedErrorBoundaryForHotReloading} from './ReactFiberHotReloading';
import {
  suspenseStackCursor,
  InvisibleParentSuspenseContext,
  hasSuspenseContext,
} from './ReactFiberSuspenseContext';
import {
  renderDidError,
  onUncaughtError,
  markLegacyErrorBoundaryAsFailed,
  isAlreadyFailedLegacyErrorBoundary,
  pingSuspendedRoot,
} from './ReactFiberWorkLoop';

import {Sync} from './ReactFiberExpirationTime';

const PossiblyWeakMap = typeof WeakMap === 'function' ? WeakMap : Map;

function createRootErrorUpdate(
  fiber: Fiber,
  errorInfo: CapturedValue<mixed>,
  expirationTime: ExpirationTime,
): Update<mixed> {
  const update = createUpdate(expirationTime, null);
  // Unmount the root by rendering null.
  update.tag = CaptureUpdate;
  // Caution: React DevTools currently depends on this property
  // being called "element".
  update.payload = {element: null};
  const error = errorInfo.value;
  update.callback = () => {
    onUncaughtError(error);
    logError(fiber, errorInfo);
  };
  return update;
}

function createClassErrorUpdate(
  fiber: Fiber,
  errorInfo: CapturedValue<mixed>,
  expirationTime: ExpirationTime,
): Update<mixed> {
  const update = createUpdate(expirationTime, null);
  update.tag = CaptureUpdate;
  const getDerivedStateFromError = fiber.type.getDerivedStateFromError;
  if (typeof getDerivedStateFromError === 'function') {
    const error = errorInfo.value;
    update.payload = () => {
      logError(fiber, errorInfo);
      return getDerivedStateFromError(error);
    };
  }

  const inst = fiber.stateNode;
  if (inst !== null && typeof inst.componentDidCatch === 'function') {
    update.callback = function callback() {
      if (__DEV__) {
        markFailedErrorBoundaryForHotReloading(fiber);
      }
      if (typeof getDerivedStateFromError !== 'function') {
        // To preserve the preexisting retry behavior of error boundaries,
        // we keep track of which ones already failed during this batch.
        // This gets reset before we yield back to the browser.
        // TODO: Warn in strict mode if getDerivedStateFromError is
        // not defined.
        markLegacyErrorBoundaryAsFailed(this);

        // Only log here if componentDidCatch is the only error boundary method defined
        logError(fiber, errorInfo);
      }
      const error = errorInfo.value;
      const stack = errorInfo.stack;
      this.componentDidCatch(error, {
        componentStack: stack !== null ? stack : '',
      });
      if (__DEV__) {
        if (typeof getDerivedStateFromError !== 'function') {
          // If componentDidCatch is the only error boundary method defined,
          // then it needs to call setState to recover from errors.
          // If no state update is scheduled then the boundary will swallow the error.
          if (fiber.expirationTime !== Sync) {
            console.error(
              '%s: Error boundaries should implement getDerivedStateFromError(). ' +
                'In that method, return a state update to display an error message or fallback UI.',
              getComponentName(fiber.type) || 'Unknown',
            );
          }
        }
      }
    };
  } else if (__DEV__) {
    update.callback = () => {
      markFailedErrorBoundaryForHotReloading(fiber);
    };
  }
  return update;
}

function attachPingListener(
  root: FiberRoot,
  renderExpirationTime: ExpirationTime,
  thenable: Thenable,
) {
  // Attach a listener to the promise to "ping" the root and retry. But
  // only if one does not already exist for the current render expiration
  // time (which acts like a "thread ID" here).
  let pingCache = root.pingCache;
  let threadIDs;
  if (pingCache === null) {
    pingCache = root.pingCache = new PossiblyWeakMap();
    threadIDs = new Set();
    pingCache.set(thenable, threadIDs);
  } else {
    threadIDs = pingCache.get(thenable);
    if (threadIDs === undefined) {
      threadIDs = new Set();
      pingCache.set(thenable, threadIDs);
    }
  }
  if (!threadIDs.has(renderExpirationTime)) {
    // Memoize using the thread ID to prevent redundant listeners.
    threadIDs.add(renderExpirationTime);
    let ping = pingSuspendedRoot.bind(
      null,
      root,
      thenable,
      renderExpirationTime,
    );
    thenable.then(ping, ping);
  }
}

function throwException(
  root: FiberRoot,
  returnFiber: Fiber,
  sourceFiber: Fiber,
  value: mixed,
  renderExpirationTime: ExpirationTime,
) {
  // The source fiber did not complete.
  sourceFiber.effectTag |= Incomplete;
  // Its effect list is no longer valid.
  sourceFiber.firstEffect = sourceFiber.lastEffect = null;

  if (
    value !== null &&
    typeof value === 'object' &&
    typeof value.then === 'function'
  ) {
    // This is a thenable.
    const thenable: Thenable = (value: any);

    if ((sourceFiber.mode & BlockingMode) === NoMode) {
      // Reset the memoizedState to what it was before we attempted
      // to render it.
      let currentSource = sourceFiber.alternate;
      if (currentSource) {
        sourceFiber.updateQueue = currentSource.updateQueue;
        sourceFiber.memoizedState = currentSource.memoizedState;
        sourceFiber.expirationTime = currentSource.expirationTime;
      } else {
        sourceFiber.updateQueue = null;
        sourceFiber.memoizedState = null;
      }
    }

    let hasInvisibleParentBoundary = hasSuspenseContext(
      suspenseStackCursor.current,
      (InvisibleParentSuspenseContext: SuspenseContext),
    );

    // Schedule the nearest Suspense to re-render the timed out view.
    let workInProgress = returnFiber;
    do {
      if (
        workInProgress.tag === SuspenseComponent &&
        shouldCaptureSuspense(workInProgress, hasInvisibleParentBoundary)
      ) {
        // Found the nearest boundary.

        // Stash the promise on the boundary fiber. If the boundary times out, we'll
        // attach another listener to flip the boundary back to its normal state.
        const thenables: Set<Thenable> = (workInProgress.updateQueue: any);
        if (thenables === null) {
          const updateQueue = (new Set(): any);
          updateQueue.add(thenable);
          workInProgress.updateQueue = updateQueue;
        } else {
          thenables.add(thenable);
        }

        // If the boundary is outside of blocking mode, we should *not*
        // suspend the commit. Pretend as if the suspended component rendered
        // null and keep rendering. In the commit phase, we'll schedule a
        // subsequent synchronous update to re-render the Suspense.
        //
        // Note: It doesn't matter whether the component that suspended was
        // inside a blocking mode tree. If the Suspense is outside of it, we
        // should *not* suspend the commit.
        if ((workInProgress.mode & BlockingMode) === NoMode) {
          workInProgress.effectTag |= DidCapture;

          // We're going to commit this fiber even though it didn't complete.
          // But we shouldn't call any lifecycle methods or callbacks. Remove
          // all lifecycle effect tags.
          sourceFiber.effectTag &= ~(LifecycleEffectMask | Incomplete);

          if (sourceFiber.tag === ClassComponent) {
            const currentSourceFiber = sourceFiber.alternate;
            if (currentSourceFiber === null) {
              // This is a new mount. Change the tag so it's not mistaken for a
              // completed class component. For example, we should not call
              // componentWillUnmount if it is deleted.
              sourceFiber.tag = IncompleteClassComponent;
            } else {
              // When we try rendering again, we should not reuse the current fiber,
              // since it's known to be in an inconsistent state. Use a force update to
              // prevent a bail out.
              const update = createUpdate(Sync, null);
              update.tag = ForceUpdate;
              enqueueUpdate(sourceFiber, update);
            }
          }

          // The source fiber did not complete. Mark it with Sync priority to
          // indicate that it still has pending work.
          sourceFiber.expirationTime = Sync;

          // Exit without suspending.
          return;
        }

        // Confirmed that the boundary is in a concurrent mode tree. Continue
        // with the normal suspend path.
        //
        // After this we'll use a set of heuristics to determine whether this
        // render pass will run to completion or restart or "suspend" the commit.
        // The actual logic for this is spread out in different places.
        //
        // This first principle is that if we're going to suspend when we complete
        // a root, then we should also restart if we get an update or ping that
        // might unsuspend it, and vice versa. The only reason to suspend is
        // because you think you might want to restart before committing. However,
        // it doesn't make sense to restart only while in the period we're suspended.
        //
        // Restarting too aggressively is also not good because it starves out any
        // intermediate loading state. So we use heuristics to determine when.

        // Suspense Heuristics
        //
        // If nothing threw a Promise or all the same fallbacks are already showing,
        // then don't suspend/restart.
        //
        // If this is an initial render of a new tree of Suspense boundaries and
        // those trigger a fallback, then don't suspend/restart. We want to ensure
        // that we can show the initial loading state as quickly as possible.
        //
        // If we hit a "Delayed" case, such as when we'd switch from content back into
        // a fallback, then we should always suspend/restart. SuspenseConfig applies to
        // this case. If none is defined, JND is used instead.
        //
        // If we're already showing a fallback and it gets "retried", allowing us to show
        // another level, but there's still an inner boundary that would show a fallback,
        // then we suspend/restart for 500ms since the last time we showed a fallback
        // anywhere in the tree. This effectively throttles progressive loading into a
        // consistent train of commits. This also gives us an opportunity to restart to
        // get to the completed state slightly earlier.
        //
        // If there's ambiguity due to batching it's resolved in preference of:
        // 1) "delayed", 2) "initial render", 3) "retry".
        //
        // We want to ensure that a "busy" state doesn't get force committed. We want to
        // ensure that new initial loading states can commit as soon as possible.

        attachPingListener(root, renderExpirationTime, thenable);

        workInProgress.effectTag |= ShouldCapture;
        workInProgress.expirationTime = renderExpirationTime;

        return;
      }
      // This boundary already captured during this render. Continue to the next
      // boundary.
      workInProgress = workInProgress.return;
    } while (workInProgress !== null);
    // No boundary was found. Fallthrough to error mode.
    // TODO: Use invariant so the message is stripped in prod?
    value = new Error(
      (getComponentName(sourceFiber.type) || 'A React component') +
        ' suspended while rendering, but no fallback UI was specified.\n' +
        '\n' +
        'Add a <Suspense fallback=...> component higher in the tree to ' +
        'provide a loading indicator or placeholder to display.' +
        getStackByFiberInDevAndProd(sourceFiber),
    );
  }

  // We didn't find a boundary that could handle this type of exception. Start
  // over and traverse parent path again, this time treating the exception
  // as an error.
  renderDidError();
  value = createCapturedValue(value, sourceFiber);
  let workInProgress = returnFiber;
  do {
    switch (workInProgress.tag) {
      case HostRoot: {
        const errorInfo = value;
        workInProgress.effectTag |= ShouldCapture;
        workInProgress.expirationTime = renderExpirationTime;
        const update = createRootErrorUpdate(
          workInProgress,
          errorInfo,
          renderExpirationTime,
        );
        enqueueCapturedUpdate(workInProgress, update);
        return;
      }
      case ClassComponent:
        // Capture and retry
        const errorInfo = value;
        const ctor = workInProgress.type;
        const instance = workInProgress.stateNode;
        if (
          (workInProgress.effectTag & DidCapture) === NoEffect &&
          (typeof ctor.getDerivedStateFromError === 'function' ||
            (instance !== null &&
              typeof instance.componentDidCatch === 'function' &&
              !isAlreadyFailedLegacyErrorBoundary(instance)))
        ) {
          workInProgress.effectTag |= ShouldCapture;
          workInProgress.expirationTime = renderExpirationTime;
          // Schedule the error boundary to re-render using updated state
          const update = createClassErrorUpdate(
            workInProgress,
            errorInfo,
            renderExpirationTime,
          );
          enqueueCapturedUpdate(workInProgress, update);
          return;
        }
        break;
      default:
        break;
    }
    workInProgress = workInProgress.return;
  } while (workInProgress !== null);
}

export {throwException, createRootErrorUpdate, createClassErrorUpdate};
