/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import * as React from 'react';
import {Fragment, useContext, useMemo, useState} from 'react';
import Store from 'react-devtools-shared/src/devtools/store';
import Badge from './Badge';
import ButtonIcon from '../ButtonIcon';
import {createRegExp} from '../utils';
import {TreeDispatcherContext, TreeStateContext} from './TreeContext';
import {StoreContext} from '../context';

import type {ItemData} from './Tree';
import type {Element} from './types';

import styles from './Element.css';

type Props = {
  data: ItemData,
  index: number,
  style: Object,
  ...
};

export default function ElementView({data, index, style}: Props) {
  const store = useContext(StoreContext);
  const {ownerFlatTree, ownerID, selectedElementID} = useContext(
    TreeStateContext,
  );
  const dispatch = useContext(TreeDispatcherContext);

  const element =
    ownerFlatTree !== null
      ? ownerFlatTree[index]
      : store.getElementAtIndex(index);

  const [isHovered, setIsHovered] = useState(false);

  const {isNavigatingWithKeyboard, onElementMouseEnter, treeFocused} = data;
  const id = element === null ? null : element.id;
  const isSelected = selectedElementID === id;

  const handleDoubleClick = () => {
    if (id !== null) {
      dispatch({type: 'SELECT_OWNER', payload: id});
    }
  };

  const handleMouseDown = ({metaKey}) => {
    if (id !== null) {
      dispatch({
        type: 'SELECT_ELEMENT_BY_ID',
        payload: metaKey ? null : id,
      });
    }
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (id !== null) {
      onElementMouseEnter(id);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  const handleKeyDoubleClick = event => {
    // Double clicks on key value are used for text selection (if the text has been truncated).
    // They should not enter the owners tree view.
    event.stopPropagation();
    event.preventDefault();
  };

  // Handle elements that are removed from the tree while an async render is in progress.
  if (element == null) {
    console.warn(`<ElementView> Could not find element at index ${index}`);

    // This return needs to happen after hooks, since hooks can't be conditional.
    return null;
  }

  const {
    depth,
    displayName,
    hocDisplayNames,
    key,
    type,
  } = ((element: any): Element);

  let className = styles.Element;
  if (isSelected) {
    className = treeFocused
      ? styles.SelectedElement
      : styles.InactiveSelectedElement;
  } else if (isHovered && !isNavigatingWithKeyboard) {
    className = styles.HoveredElement;
  }

  return (
    <div
      className={className}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      style={style}
      data-depth={depth}>
      {/* This wrapper is used by Tree for measurement purposes. */}
      <div
        className={styles.Wrapper}
        style={{
          // Left offset presents the appearance of a nested tree structure.
          // We must use padding rather than margin/left because of the selected background color.
          transform: `translateX(calc(${depth} * var(--indentation-size)))`,
        }}>
        {ownerID === null ? (
          <ExpandCollapseToggle element={element} store={store} />
        ) : null}
        <DisplayName displayName={displayName} id={((id: any): number)} />
        {key && (
          <Fragment>
            &nbsp;<span className={styles.KeyName}>key</span>="
            <span
              className={styles.KeyValue}
              title={key}
              onDoubleClick={handleKeyDoubleClick}>
              {key}
            </span>
            "
          </Fragment>
        )}
        <Badge
          className={styles.Badge}
          hocDisplayNames={hocDisplayNames}
          type={type}
        />
      </div>
    </div>
  );
}

// Prevent double clicks on toggle from drilling into the owner list.
const swallowDoubleClick = event => {
  event.preventDefault();
  event.stopPropagation();
};

type ExpandCollapseToggleProps = {|
  element: Element,
  store: Store,
|};

function ExpandCollapseToggle({element, store}: ExpandCollapseToggleProps) {
  const {children, id, isCollapsed} = element;

  const toggleCollapsed = event => {
    event.preventDefault();
    event.stopPropagation();

    store.toggleIsCollapsed(id, !isCollapsed);
  };

  const stopPropagation = event => {
    // Prevent the row from selecting
    event.stopPropagation();
  };

  if (children.length === 0) {
    return <div className={styles.ExpandCollapseToggle} />;
  }

  return (
    <div
      className={styles.ExpandCollapseToggle}
      onMouseDown={stopPropagation}
      onClick={toggleCollapsed}
      onDoubleClick={swallowDoubleClick}>
      <ButtonIcon type={isCollapsed ? 'collapsed' : 'expanded'} />
    </div>
  );
}

type DisplayNameProps = {|
  displayName: string | null,
  id: number,
|};

function DisplayName({displayName, id}: DisplayNameProps) {
  const {searchIndex, searchResults, searchText} = useContext(TreeStateContext);
  const isSearchResult = useMemo(() => {
    return searchResults.includes(id);
  }, [id, searchResults]);
  const isCurrentResult =
    searchIndex !== null && id === searchResults[searchIndex];

  if (!isSearchResult || displayName === null) {
    return displayName;
  }

  const match = createRegExp(searchText).exec(displayName);

  if (match === null) {
    return displayName;
  }

  const startIndex = match.index;
  const stopIndex = startIndex + match[0].length;

  const children = [];
  if (startIndex > 0) {
    children.push(<span key="begin">{displayName.slice(0, startIndex)}</span>);
  }
  children.push(
    <mark
      key="middle"
      className={isCurrentResult ? styles.CurrentHighlight : styles.Highlight}>
      {displayName.slice(startIndex, stopIndex)}
    </mark>,
  );
  if (stopIndex < displayName.length) {
    children.push(<span key="end">{displayName.slice(stopIndex)}</span>);
  }

  return children;
}
