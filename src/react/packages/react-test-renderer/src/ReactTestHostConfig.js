/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  ReactEventResponder,
  ReactEventResponderInstance,
  ReactFundamentalComponentInstance,
} from 'shared/ReactTypes';

import {enableDeprecatedFlareAPI} from 'shared/ReactFeatureFlags';

export type Type = string;
export type Props = Object;
export type Container = {|
  children: Array<Instance | TextInstance>,
  createNodeMock: Function,
  tag: 'CONTAINER',
|};
export type Instance = {|
  type: string,
  props: Object,
  isHidden: boolean,
  children: Array<Instance | TextInstance>,
  internalInstanceHandle: Object,
  rootContainerInstance: Container,
  tag: 'INSTANCE',
|};
export type TextInstance = {|
  text: string,
  isHidden: boolean,
  tag: 'TEXT',
|};
export type HydratableInstance = Instance | TextInstance;
export type PublicInstance = Instance | TextInstance;
export type HostContext = Object;
export type UpdatePayload = Object;
export type ChildSet = void; // Unused
export type TimeoutHandle = TimeoutID;
export type NoTimeout = -1;
export type EventResponder = any;

export * from 'shared/HostConfigWithNoPersistence';
export * from 'shared/HostConfigWithNoHydration';

const EVENT_COMPONENT_CONTEXT = {};
const NO_CONTEXT = {};
const UPDATE_SIGNAL = {};
const nodeToInstanceMap = new WeakMap();

if (__DEV__) {
  Object.freeze(NO_CONTEXT);
  Object.freeze(UPDATE_SIGNAL);
}

export function getPublicInstance(inst: Instance | TextInstance): * {
  switch (inst.tag) {
    case 'INSTANCE':
      const createNodeMock = inst.rootContainerInstance.createNodeMock;
      const mockNode = createNodeMock({
        type: inst.type,
        props: inst.props,
      });
      if (typeof mockNode === 'object' && mockNode !== null) {
        nodeToInstanceMap.set(mockNode, inst);
      }
      return mockNode;
    default:
      return inst;
  }
}

export function appendChild(
  parentInstance: Instance | Container,
  child: Instance | TextInstance,
): void {
  if (__DEV__) {
    if (!Array.isArray(parentInstance.children)) {
      console.error(
        'An invalid container has been provided. ' +
          'This may indicate that another renderer is being used in addition to the test renderer. ' +
          '(For example, ReactDOM.createPortal inside of a ReactTestRenderer tree.) ' +
          'This is not supported.',
      );
    }
  }
  const index = parentInstance.children.indexOf(child);
  if (index !== -1) {
    parentInstance.children.splice(index, 1);
  }
  parentInstance.children.push(child);
}

export function insertBefore(
  parentInstance: Instance | Container,
  child: Instance | TextInstance,
  beforeChild: Instance | TextInstance,
): void {
  const index = parentInstance.children.indexOf(child);
  if (index !== -1) {
    parentInstance.children.splice(index, 1);
  }
  const beforeIndex = parentInstance.children.indexOf(beforeChild);
  parentInstance.children.splice(beforeIndex, 0, child);
}

export function removeChild(
  parentInstance: Instance | Container,
  child: Instance | TextInstance,
): void {
  const index = parentInstance.children.indexOf(child);
  parentInstance.children.splice(index, 1);
}

export function getRootHostContext(
  rootContainerInstance: Container,
): HostContext {
  return NO_CONTEXT;
}

export function getChildHostContext(
  parentHostContext: HostContext,
  type: string,
  rootContainerInstance: Container,
): HostContext {
  return NO_CONTEXT;
}

export function prepareForCommit(containerInfo: Container): void {
  // noop
}

export function resetAfterCommit(containerInfo: Container): void {
  // noop
}

export function createInstance(
  type: string,
  props: Props,
  rootContainerInstance: Container,
  hostContext: Object,
  internalInstanceHandle: Object,
): Instance {
  let propsToUse = props;
  if (enableDeprecatedFlareAPI) {
    if (props.DEPRECATED_flareListeners != null) {
      // We want to remove the "DEPRECATED_flareListeners" prop
      // as we don't want it in the test renderer's
      // instance props.
      const {DEPRECATED_flareListeners, ...otherProps} = props; // eslint-disable-line
      propsToUse = otherProps;
    }
  }
  return {
    type,
    props: propsToUse,
    isHidden: false,
    children: [],
    internalInstanceHandle,
    rootContainerInstance,
    tag: 'INSTANCE',
  };
}

export function appendInitialChild(
  parentInstance: Instance,
  child: Instance | TextInstance,
): void {
  const index = parentInstance.children.indexOf(child);
  if (index !== -1) {
    parentInstance.children.splice(index, 1);
  }
  parentInstance.children.push(child);
}

export function finalizeInitialChildren(
  testElement: Instance,
  type: string,
  props: Props,
  rootContainerInstance: Container,
  hostContext: Object,
): boolean {
  return false;
}

export function prepareUpdate(
  testElement: Instance,
  type: string,
  oldProps: Props,
  newProps: Props,
  rootContainerInstance: Container,
  hostContext: Object,
): null | {...} {
  return UPDATE_SIGNAL;
}

export function shouldSetTextContent(type: string, props: Props): boolean {
  return false;
}

export function shouldDeprioritizeSubtree(type: string, props: Props): boolean {
  return false;
}

export function createTextInstance(
  text: string,
  rootContainerInstance: Container,
  hostContext: Object,
  internalInstanceHandle: Object,
): TextInstance {
  if (__DEV__) {
    if (enableDeprecatedFlareAPI) {
      if (hostContext === EVENT_COMPONENT_CONTEXT) {
        console.error(
          'validateDOMNesting: React event components cannot have text DOM nodes as children. ' +
            'Wrap the child text "%s" in an element.',
          text,
        );
      }
    }
  }
  return {
    text,
    isHidden: false,
    tag: 'TEXT',
  };
}

export const isPrimaryRenderer = false;
export const warnsIfNotActing = true;

export const scheduleTimeout = setTimeout;
export const cancelTimeout = clearTimeout;
export const noTimeout = -1;

// -------------------
//     Mutation
// -------------------

export const supportsMutation = true;

export function commitUpdate(
  instance: Instance,
  updatePayload: {...},
  type: string,
  oldProps: Props,
  newProps: Props,
  internalInstanceHandle: Object,
): void {
  instance.type = type;
  instance.props = newProps;
}

export function commitMount(
  instance: Instance,
  type: string,
  newProps: Props,
  internalInstanceHandle: Object,
): void {
  // noop
}

export function commitTextUpdate(
  textInstance: TextInstance,
  oldText: string,
  newText: string,
): void {
  textInstance.text = newText;
}

export function resetTextContent(testElement: Instance): void {
  // noop
}

export const appendChildToContainer = appendChild;
export const insertInContainerBefore = insertBefore;
export const removeChildFromContainer = removeChild;

export function hideInstance(instance: Instance): void {
  instance.isHidden = true;
}

export function hideTextInstance(textInstance: TextInstance): void {
  textInstance.isHidden = true;
}

export function unhideInstance(instance: Instance, props: Props): void {
  instance.isHidden = false;
}

export function unhideTextInstance(
  textInstance: TextInstance,
  text: string,
): void {
  textInstance.isHidden = false;
}

export function DEPRECATED_mountResponderInstance(
  responder: ReactEventResponder<any, any>,
  responderInstance: ReactEventResponderInstance<any, any>,
  props: Object,
  state: Object,
  instance: Instance,
) {
  // noop
}

export function DEPRECATED_unmountResponderInstance(
  responderInstance: ReactEventResponderInstance<any, any>,
): void {
  // noop
}

export function getFundamentalComponentInstance(
  fundamentalInstance: ReactFundamentalComponentInstance<any, any>,
): Instance {
  const {impl, props, state} = fundamentalInstance;
  return impl.getInstance(null, props, state);
}

export function mountFundamentalComponent(
  fundamentalInstance: ReactFundamentalComponentInstance<any, any>,
): void {
  const {impl, instance, props, state} = fundamentalInstance;
  const onMount = impl.onMount;
  if (onMount !== undefined) {
    onMount(null, instance, props, state);
  }
}

export function shouldUpdateFundamentalComponent(
  fundamentalInstance: ReactFundamentalComponentInstance<any, any>,
): boolean {
  const {impl, prevProps, props, state} = fundamentalInstance;
  const shouldUpdate = impl.shouldUpdate;
  if (shouldUpdate !== undefined) {
    return shouldUpdate(null, prevProps, props, state);
  }
  return true;
}

export function updateFundamentalComponent(
  fundamentalInstance: ReactFundamentalComponentInstance<any, any>,
): void {
  const {impl, instance, prevProps, props, state} = fundamentalInstance;
  const onUpdate = impl.onUpdate;
  if (onUpdate !== undefined) {
    onUpdate(null, instance, prevProps, props, state);
  }
}

export function unmountFundamentalComponent(
  fundamentalInstance: ReactFundamentalComponentInstance<any, any>,
): void {
  const {impl, instance, props, state} = fundamentalInstance;
  const onUnmount = impl.onUnmount;
  if (onUnmount !== undefined) {
    onUnmount(null, instance, props, state);
  }
}

export function getInstanceFromNode(mockNode: Object) {
  const instance = nodeToInstanceMap.get(mockNode);
  if (instance !== undefined) {
    return instance.internalInstanceHandle;
  }
  return null;
}

export function beforeRemoveInstance(instance: any) {
  // noop
}
