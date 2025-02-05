/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  ReactContext,
  ReactProviderType,
  ReactEventResponder,
  ReactEventResponderListener,
} from 'shared/ReactTypes';
import type {Fiber} from 'react-reconciler/src/ReactFiber';
import type {Hook, TimeoutConfig} from 'react-reconciler/src/ReactFiberHooks';
import type {Dispatcher as DispatcherType} from 'react-reconciler/src/ReactFiberHooks';
import type {SuspenseConfig} from 'react-reconciler/src/ReactFiberSuspenseConfig';

import ErrorStackParser from 'error-stack-parser';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import {
  FunctionComponent,
  SimpleMemoComponent,
  ContextProvider,
  ForwardRef,
  Block,
} from 'shared/ReactWorkTags';

type CurrentDispatcherRef = typeof ReactSharedInternals.ReactCurrentDispatcher;

// Used to track hooks called during a render

type HookLogEntry = {
  primitive: string,
  stackError: Error,
  value: mixed,
  ...
};

let hookLog: Array<HookLogEntry> = [];

// Primitives

type BasicStateAction<S> = (S => S) | S;

type Dispatch<A> = A => void;

let primitiveStackCache: null | Map<string, Array<any>> = null;

function getPrimitiveStackCache(): Map<string, Array<any>> {
  // This initializes a cache of all primitive hooks so that the top
  // most stack frames added by calling the primitive hook can be removed.
  if (primitiveStackCache === null) {
    let cache = new Map();
    let readHookLog;
    try {
      // Use all hooks here to add them to the hook log.
      Dispatcher.useContext(({_currentValue: null}: any));
      Dispatcher.useState(null);
      Dispatcher.useReducer((s, a) => s, null);
      Dispatcher.useRef(null);
      Dispatcher.useLayoutEffect(() => {});
      Dispatcher.useEffect(() => {});
      Dispatcher.useImperativeHandle(undefined, () => null);
      Dispatcher.useDebugValue(null);
      Dispatcher.useCallback(() => {});
      Dispatcher.useMemo(() => null);
    } finally {
      readHookLog = hookLog;
      hookLog = [];
    }
    for (let i = 0; i < readHookLog.length; i++) {
      let hook = readHookLog[i];
      cache.set(hook.primitive, ErrorStackParser.parse(hook.stackError));
    }
    primitiveStackCache = cache;
  }
  return primitiveStackCache;
}

let currentHook: null | Hook = null;
function nextHook(): null | Hook {
  let hook = currentHook;
  if (hook !== null) {
    currentHook = hook.next;
  }
  return hook;
}

function readContext<T>(
  context: ReactContext<T>,
  observedBits: void | number | boolean,
): T {
  // For now we don't expose readContext usage in the hooks debugging info.
  return context._currentValue;
}

function useContext<T>(
  context: ReactContext<T>,
  observedBits: void | number | boolean,
): T {
  hookLog.push({
    primitive: 'Context',
    stackError: new Error(),
    value: context._currentValue,
  });
  return context._currentValue;
}

function useState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  let hook = nextHook();
  let state: S =
    hook !== null
      ? hook.memoizedState
      : typeof initialState === 'function'
      ? // $FlowFixMe: Flow doesn't like mixed types
        initialState()
      : initialState;
  hookLog.push({primitive: 'State', stackError: new Error(), value: state});
  return [state, (action: BasicStateAction<S>) => {}];
}

function useReducer<S, I, A>(
  reducer: (S, A) => S,
  initialArg: I,
  init?: I => S,
): [S, Dispatch<A>] {
  let hook = nextHook();
  let state;
  if (hook !== null) {
    state = hook.memoizedState;
  } else {
    state = init !== undefined ? init(initialArg) : ((initialArg: any): S);
  }
  hookLog.push({
    primitive: 'Reducer',
    stackError: new Error(),
    value: state,
  });
  return [state, (action: A) => {}];
}

function useRef<T>(initialValue: T): {|current: T|} {
  let hook = nextHook();
  let ref = hook !== null ? hook.memoizedState : {current: initialValue};
  hookLog.push({
    primitive: 'Ref',
    stackError: new Error(),
    value: ref.current,
  });
  return ref;
}

function useLayoutEffect(
  create: () => (() => void) | void,
  inputs: Array<mixed> | void | null,
): void {
  nextHook();
  hookLog.push({
    primitive: 'LayoutEffect',
    stackError: new Error(),
    value: create,
  });
}

function useEffect(
  create: () => (() => void) | void,
  inputs: Array<mixed> | void | null,
): void {
  nextHook();
  hookLog.push({primitive: 'Effect', stackError: new Error(), value: create});
}

function useImperativeHandle<T>(
  ref: {|current: T | null|} | ((inst: T | null) => mixed) | null | void,
  create: () => T,
  inputs: Array<mixed> | void | null,
): void {
  nextHook();
  // We don't actually store the instance anywhere if there is no ref callback
  // and if there is a ref callback it might not store it but if it does we
  // have no way of knowing where. So let's only enable introspection of the
  // ref itself if it is using the object form.
  let instance = undefined;
  if (ref !== null && typeof ref === 'object') {
    instance = ref.current;
  }
  hookLog.push({
    primitive: 'ImperativeHandle',
    stackError: new Error(),
    value: instance,
  });
}

function useDebugValue(value: any, formatterFn: ?(value: any) => any) {
  hookLog.push({
    primitive: 'DebugValue',
    stackError: new Error(),
    value: typeof formatterFn === 'function' ? formatterFn(value) : value,
  });
}

function useCallback<T>(callback: T, inputs: Array<mixed> | void | null): T {
  let hook = nextHook();
  hookLog.push({
    primitive: 'Callback',
    stackError: new Error(),
    value: hook !== null ? hook.memoizedState[0] : callback,
  });
  return callback;
}

function useMemo<T>(
  nextCreate: () => T,
  inputs: Array<mixed> | void | null,
): T {
  let hook = nextHook();
  let value = hook !== null ? hook.memoizedState[0] : nextCreate();
  hookLog.push({primitive: 'Memo', stackError: new Error(), value});
  return value;
}

function useResponder(
  responder: ReactEventResponder<any, any>,
  listenerProps: Object,
): ReactEventResponderListener<any, any> {
  // Don't put the actual event responder object in, just its displayName
  const value = {
    responder: responder.displayName || 'EventResponder',
    props: listenerProps,
  };
  hookLog.push({primitive: 'Responder', stackError: new Error(), value});
  return {
    responder,
    props: listenerProps,
  };
}

function useTransition(
  config: SuspenseConfig | null | void,
): [(() => void) => void, boolean] {
  nextHook();
  hookLog.push({
    primitive: 'Transition',
    stackError: new Error(),
    value: config,
  });
  return [callback => {}, false];
}

function useDeferredValue<T>(value: T, config: TimeoutConfig | null | void): T {
  nextHook();
  hookLog.push({
    primitive: 'DeferredValue',
    stackError: new Error(),
    value,
  });
  return value;
}

const Dispatcher: DispatcherType = {
  readContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useDebugValue,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useResponder,
  useTransition,
  useDeferredValue,
};

// Inspect

export type HooksNode = {
  id: number | null,
  isStateEditable: boolean,
  name: string,
  value: mixed,
  subHooks: Array<HooksNode>,
  ...
};
export type HooksTree = Array<HooksNode>;

// Don't assume
//
// We can't assume that stack frames are nth steps away from anything.
// E.g. we can't assume that the root call shares all frames with the stack
// of a hook call. A simple way to demonstrate this is wrapping `new Error()`
// in a wrapper constructor like a polyfill. That'll add an extra frame.
// Similar things can happen with the call to the dispatcher. The top frame
// may not be the primitive. Likewise the primitive can have fewer stack frames
// such as when a call to useState got inlined to use dispatcher.useState.
//
// We also can't assume that the last frame of the root call is the same
// frame as the last frame of the hook call because long stack traces can be
// truncated to a stack trace limit.

let mostLikelyAncestorIndex = 0;

function findSharedIndex(hookStack, rootStack, rootIndex) {
  let source = rootStack[rootIndex].source;
  hookSearch: for (let i = 0; i < hookStack.length; i++) {
    if (hookStack[i].source === source) {
      // This looks like a match. Validate that the rest of both stack match up.
      for (
        let a = rootIndex + 1, b = i + 1;
        a < rootStack.length && b < hookStack.length;
        a++, b++
      ) {
        if (hookStack[b].source !== rootStack[a].source) {
          // If not, give up and try a different match.
          continue hookSearch;
        }
      }
      return i;
    }
  }
  return -1;
}

function findCommonAncestorIndex(rootStack, hookStack) {
  let rootIndex = findSharedIndex(
    hookStack,
    rootStack,
    mostLikelyAncestorIndex,
  );
  if (rootIndex !== -1) {
    return rootIndex;
  }
  // If the most likely one wasn't a hit, try any other frame to see if it is shared.
  // If that takes more than 5 frames, something probably went wrong.
  for (let i = 0; i < rootStack.length && i < 5; i++) {
    rootIndex = findSharedIndex(hookStack, rootStack, i);
    if (rootIndex !== -1) {
      mostLikelyAncestorIndex = i;
      return rootIndex;
    }
  }
  return -1;
}

function isReactWrapper(functionName, primitiveName) {
  if (!functionName) {
    return false;
  }
  let expectedPrimitiveName = 'use' + primitiveName;
  if (functionName.length < expectedPrimitiveName.length) {
    return false;
  }
  return (
    functionName.lastIndexOf(expectedPrimitiveName) ===
    functionName.length - expectedPrimitiveName.length
  );
}

function findPrimitiveIndex(hookStack, hook) {
  let stackCache = getPrimitiveStackCache();
  let primitiveStack = stackCache.get(hook.primitive);
  if (primitiveStack === undefined) {
    return -1;
  }
  for (let i = 0; i < primitiveStack.length && i < hookStack.length; i++) {
    if (primitiveStack[i].source !== hookStack[i].source) {
      // If the next two frames are functions called `useX` then we assume that they're part of the
      // wrappers that the React packager or other packages adds around the dispatcher.
      if (
        i < hookStack.length - 1 &&
        isReactWrapper(hookStack[i].functionName, hook.primitive)
      ) {
        i++;
      }
      if (
        i < hookStack.length - 1 &&
        isReactWrapper(hookStack[i].functionName, hook.primitive)
      ) {
        i++;
      }
      return i;
    }
  }
  return -1;
}

function parseTrimmedStack(rootStack, hook) {
  // Get the stack trace between the primitive hook function and
  // the root function call. I.e. the stack frames of custom hooks.
  let hookStack = ErrorStackParser.parse(hook.stackError);
  let rootIndex = findCommonAncestorIndex(rootStack, hookStack);
  let primitiveIndex = findPrimitiveIndex(hookStack, hook);
  if (
    rootIndex === -1 ||
    primitiveIndex === -1 ||
    rootIndex - primitiveIndex < 2
  ) {
    // Something went wrong. Give up.
    return null;
  }
  return hookStack.slice(primitiveIndex, rootIndex - 1);
}

function parseCustomHookName(functionName: void | string): string {
  if (!functionName) {
    return '';
  }
  let startIndex = functionName.lastIndexOf('.');
  if (startIndex === -1) {
    startIndex = 0;
  }
  if (functionName.substr(startIndex, 3) === 'use') {
    startIndex += 3;
  }
  return functionName.substr(startIndex);
}

function buildTree(rootStack, readHookLog): HooksTree {
  let rootChildren = [];
  let prevStack = null;
  let levelChildren = rootChildren;
  let nativeHookID = 0;
  let stackOfChildren = [];
  for (let i = 0; i < readHookLog.length; i++) {
    let hook = readHookLog[i];
    let stack = parseTrimmedStack(rootStack, hook);
    if (stack !== null) {
      // Note: The indices 0 <= n < length-1 will contain the names.
      // The indices 1 <= n < length will contain the source locations.
      // That's why we get the name from n - 1 and don't check the source
      // of index 0.
      let commonSteps = 0;
      if (prevStack !== null) {
        // Compare the current level's stack to the new stack.
        while (commonSteps < stack.length && commonSteps < prevStack.length) {
          let stackSource = stack[stack.length - commonSteps - 1].source;
          let prevSource = prevStack[prevStack.length - commonSteps - 1].source;
          if (stackSource !== prevSource) {
            break;
          }
          commonSteps++;
        }
        // Pop back the stack as many steps as were not common.
        for (let j = prevStack.length - 1; j > commonSteps; j--) {
          levelChildren = stackOfChildren.pop();
        }
      }
      // The remaining part of the new stack are custom hooks. Push them
      // to the tree.
      for (let j = stack.length - commonSteps - 1; j >= 1; j--) {
        let children = [];
        levelChildren.push({
          id: null,
          isStateEditable: false,
          name: parseCustomHookName(stack[j - 1].functionName),
          value: undefined,
          subHooks: children,
        });
        stackOfChildren.push(levelChildren);
        levelChildren = children;
      }
      prevStack = stack;
    }
    const {primitive} = hook;

    // For now, the "id" of stateful hooks is just the stateful hook index.
    // Custom hooks have no ids, nor do non-stateful native hooks (e.g. Context, DebugValue).
    const id =
      primitive === 'Context' || primitive === 'DebugValue'
        ? null
        : nativeHookID++;

    // For the time being, only State and Reducer hooks support runtime overrides.
    const isStateEditable = primitive === 'Reducer' || primitive === 'State';

    levelChildren.push({
      id,
      isStateEditable,
      name: primitive,
      value: hook.value,
      subHooks: [],
    });
  }

  // Associate custom hook values (useDebugValue() hook entries) with the correct hooks.
  processDebugValues(rootChildren, null);

  return rootChildren;
}

// Custom hooks support user-configurable labels (via the special useDebugValue() hook).
// That hook adds user-provided values to the hooks tree,
// but these values aren't intended to appear alongside of the other hooks.
// Instead they should be attributed to their parent custom hook.
// This method walks the tree and assigns debug values to their custom hook owners.
function processDebugValues(
  hooksTree: HooksTree,
  parentHooksNode: HooksNode | null,
): void {
  let debugValueHooksNodes: Array<HooksNode> = [];

  for (let i = 0; i < hooksTree.length; i++) {
    const hooksNode = hooksTree[i];
    if (hooksNode.name === 'DebugValue' && hooksNode.subHooks.length === 0) {
      hooksTree.splice(i, 1);
      i--;
      debugValueHooksNodes.push(hooksNode);
    } else {
      processDebugValues(hooksNode.subHooks, hooksNode);
    }
  }

  // Bubble debug value labels to their custom hook owner.
  // If there is no parent hook, just ignore them for now.
  // (We may warn about this in the future.)
  if (parentHooksNode !== null) {
    if (debugValueHooksNodes.length === 1) {
      parentHooksNode.value = debugValueHooksNodes[0].value;
    } else if (debugValueHooksNodes.length > 1) {
      parentHooksNode.value = debugValueHooksNodes.map(({value}) => value);
    }
  }
}

export function inspectHooks<Props>(
  renderFunction: Props => React$Node,
  props: Props,
  currentDispatcher: ?CurrentDispatcherRef,
): HooksTree {
  // DevTools will pass the current renderer's injected dispatcher.
  // Other apps might compile debug hooks as part of their app though.
  if (currentDispatcher == null) {
    currentDispatcher = ReactSharedInternals.ReactCurrentDispatcher;
  }

  let previousDispatcher = currentDispatcher.current;
  let readHookLog;
  currentDispatcher.current = Dispatcher;
  let ancestorStackError;
  try {
    ancestorStackError = new Error();
    renderFunction(props);
  } finally {
    readHookLog = hookLog;
    hookLog = [];
    currentDispatcher.current = previousDispatcher;
  }
  let rootStack = ErrorStackParser.parse(ancestorStackError);
  return buildTree(rootStack, readHookLog);
}

function setupContexts(contextMap: Map<ReactContext<any>, any>, fiber: Fiber) {
  let current = fiber;
  while (current) {
    if (current.tag === ContextProvider) {
      const providerType: ReactProviderType<any> = current.type;
      const context: ReactContext<any> = providerType._context;
      if (!contextMap.has(context)) {
        // Store the current value that we're going to restore later.
        contextMap.set(context, context._currentValue);
        // Set the inner most provider value on the context.
        context._currentValue = current.memoizedProps.value;
      }
    }
    current = current.return;
  }
}

function restoreContexts(contextMap: Map<ReactContext<any>, any>) {
  contextMap.forEach((value, context) => (context._currentValue = value));
}

function inspectHooksOfForwardRef<Props, Ref>(
  renderFunction: (Props, Ref) => React$Node,
  props: Props,
  ref: Ref,
  currentDispatcher: CurrentDispatcherRef,
): HooksTree {
  let previousDispatcher = currentDispatcher.current;
  let readHookLog;
  currentDispatcher.current = Dispatcher;
  let ancestorStackError;
  try {
    ancestorStackError = new Error();
    renderFunction(props, ref);
  } finally {
    readHookLog = hookLog;
    hookLog = [];
    currentDispatcher.current = previousDispatcher;
  }
  let rootStack = ErrorStackParser.parse(ancestorStackError);
  return buildTree(rootStack, readHookLog);
}

function resolveDefaultProps(Component, baseProps) {
  if (Component && Component.defaultProps) {
    // Resolve default props. Taken from ReactElement
    const props = Object.assign({}, baseProps);
    const defaultProps = Component.defaultProps;
    for (let propName in defaultProps) {
      if (props[propName] === undefined) {
        props[propName] = defaultProps[propName];
      }
    }
    return props;
  }
  return baseProps;
}

export function inspectHooksOfFiber(
  fiber: Fiber,
  currentDispatcher: ?CurrentDispatcherRef,
) {
  // DevTools will pass the current renderer's injected dispatcher.
  // Other apps might compile debug hooks as part of their app though.
  if (currentDispatcher == null) {
    currentDispatcher = ReactSharedInternals.ReactCurrentDispatcher;
  }

  if (
    fiber.tag !== FunctionComponent &&
    fiber.tag !== SimpleMemoComponent &&
    fiber.tag !== ForwardRef &&
    fiber.tag !== Block
  ) {
    throw new Error(
      'Unknown Fiber. Needs to be a function component to inspect hooks.',
    );
  }
  // Warm up the cache so that it doesn't consume the currentHook.
  getPrimitiveStackCache();
  let type = fiber.type;
  let props = fiber.memoizedProps;
  if (type !== fiber.elementType) {
    props = resolveDefaultProps(type, props);
  }
  // Set up the current hook so that we can step through and read the
  // current state from them.
  currentHook = (fiber.memoizedState: Hook);
  let contextMap = new Map();
  try {
    setupContexts(contextMap, fiber);
    if (fiber.tag === ForwardRef) {
      return inspectHooksOfForwardRef(
        type.render,
        props,
        fiber.ref,
        currentDispatcher,
      );
    }
    return inspectHooks(type, props, currentDispatcher);
  } finally {
    currentHook = null;
    restoreContexts(contextMap);
  }
}
