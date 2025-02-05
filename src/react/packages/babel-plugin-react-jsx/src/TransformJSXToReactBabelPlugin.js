// MIT License

// Copyright (c) 2014-present Sebastian McKenzie and other contributors

// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:

// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
// © 2019 GitHub, Inc.
'use strict';

const esutils = require('esutils');
const {
  isModule,
  addNamespace,
  addNamed,
  addDefault,
} = require('@babel/helper-module-imports');

// These are all the valid auto import types (under the config autoImport)
// that a user can specific
const IMPORT_TYPES = {
  none: 'none', // default option. Will not import anything
  require: 'require', // var _react = require("react");
  namespace: 'namespace', // import * as _react from "react";
  defaultExport: 'defaultExport', // import _default from "react";
  namedExports: 'namedExports', // import { jsx } from "react";
};

const JSX_AUTO_IMPORT_ANNOTATION_REGEX = /\*?\s*@jsxAutoImport\s+([^\s]+)/;
const JSX_IMPORT_SOURCE_ANNOTATION_REGEX = /\*?\s*@jsxImportSource\s+([^\s]+)/;

// We want to use React.createElement, even in the case of
// jsx, for <div {...props} key={key} /> to distinguish it
// from <div key={key} {...props} />. This is an intermediary
// step while we deprecate key spread from props. Afterwards,
// we will remove createElement entirely
function shouldUseCreateElement(path, types) {
  const openingPath = path.get('openingElement');
  const attributes = openingPath.node.attributes;

  let seenPropsSpread = false;
  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes[i];
    if (
      seenPropsSpread &&
      types.isJSXAttribute(attr) &&
      attr.name.name === 'key'
    ) {
      return true;
    } else if (types.isJSXSpreadAttribute(attr)) {
      seenPropsSpread = true;
    }
  }
  return false;
}

function helper(babel, opts) {
  const {types: t} = babel;

  const visitor = {};

  visitor.JSXNamespacedName = function(path, state) {
    const throwIfNamespace =
      state.opts.throwIfNamespace === undefined
        ? true
        : !!state.opts.throwIfNamespace;
    if (throwIfNamespace) {
      throw path.buildCodeFrameError(
        `Namespace tags are not supported by default. React's JSX doesn't support namespace tags. \
You can turn on the 'throwIfNamespace' flag to bypass this warning.`,
      );
    }
  };

  visitor.JSXSpreadChild = function(path) {
    throw path.buildCodeFrameError(
      'Spread children are not supported in React.',
    );
  };

  visitor.JSXElement = {
    exit(path, file) {
      let callExpr;
      if (shouldUseCreateElement(path, t)) {
        callExpr = buildCreateElementCall(path, file);
      } else {
        callExpr = buildJSXElementCall(path, file);
      }

      if (callExpr) {
        path.replaceWith(t.inherits(callExpr, path.node));
      }
    },
  };

  visitor.JSXFragment = {
    exit(path, file) {
      if (opts.compat) {
        throw path.buildCodeFrameError(
          'Fragment tags are only supported in React 16 and up.',
        );
      }
      let callExpr = buildJSXFragmentCall(path, file);

      if (callExpr) {
        path.replaceWith(t.inherits(callExpr, path.node));
      }
    },
  };

  return visitor;

  function convertJSXIdentifier(node, parent) {
    if (t.isJSXIdentifier(node)) {
      if (node.name === 'this' && t.isReferenced(node, parent)) {
        return t.thisExpression();
      } else if (esutils.keyword.isIdentifierNameES6(node.name)) {
        node.type = 'Identifier';
      } else {
        return t.stringLiteral(node.name);
      }
    } else if (t.isJSXMemberExpression(node)) {
      return t.memberExpression(
        convertJSXIdentifier(node.object, node),
        convertJSXIdentifier(node.property, node),
      );
    } else if (t.isJSXNamespacedName(node)) {
      /**
       * If there is flag "throwIfNamespace"
       * print XMLNamespace like string literal
       */
      return t.stringLiteral(`${node.namespace.name}:${node.name.name}`);
    }

    return node;
  }

  function convertAttributeValue(node) {
    if (t.isJSXExpressionContainer(node)) {
      return node.expression;
    } else {
      return node;
    }
  }

  function convertAttribute(node, duplicateChildren) {
    let value = convertAttributeValue(node.value || t.booleanLiteral(true));

    if (t.isStringLiteral(value) && !t.isJSXExpressionContainer(node.value)) {
      value.value = value.value.replace(/\n\s+/g, ' ');

      // "raw" JSXText should not be used from a StringLiteral because it needs to be escaped.
      if (value.extra && value.extra.raw) {
        delete value.extra.raw;
      }
    }
    if (duplicateChildren && duplicateChildren.length > 0) {
      value = t.sequenceExpression([...duplicateChildren, value]);
    }

    if (t.isJSXNamespacedName(node.name)) {
      node.name = t.stringLiteral(
        node.name.namespace.name + ':' + node.name.name.name,
      );
    } else if (esutils.keyword.isIdentifierNameES6(node.name.name)) {
      node.name.type = 'Identifier';
    } else {
      node.name = t.stringLiteral(node.name.name);
    }

    return t.inherits(t.objectProperty(node.name, value), node);
  }

  // Builds JSX into:
  // Production: React.jsx(type, arguments, key)
  // Development: React.jsxDEV(type, arguments, key, isStaticChildren, source, self)
  function buildJSXElementCall(path, file) {
    if (opts.filter && !opts.filter(path.node, file)) {
      return;
    }

    const openingPath = path.get('openingElement');
    openingPath.parent.children = t.react.buildChildren(openingPath.parent);

    const tagExpr = convertJSXIdentifier(
      openingPath.node.name,
      openingPath.node,
    );
    const args = [];

    let tagName;
    if (t.isIdentifier(tagExpr)) {
      tagName = tagExpr.name;
    } else if (t.isLiteral(tagExpr)) {
      tagName = tagExpr.value;
    }

    const state = {
      tagExpr: tagExpr,
      tagName: tagName,
      args: args,
    };

    if (opts.pre) {
      opts.pre(state, file);
    }

    let attribs = [];
    let key;
    let source;
    let self;

    // for React.jsx, key, __source (dev), and __self (dev) is passed in as
    // a separate argument rather than in the args object. We go through the
    // props and filter out these three keywords so we can pass them in
    // as separate arguments later
    for (let i = 0; i < openingPath.node.attributes.length; i++) {
      const attr = openingPath.node.attributes[i];
      if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
        if (attr.name.name === 'key') {
          key = convertAttribute(attr).value;
        } else if (attr.name.name === '__source') {
          source = convertAttribute(attr).value;
        } else if (attr.name.name === '__self') {
          self = convertAttribute(attr).value;
        } else {
          attribs.push(attr);
        }
      } else {
        attribs.push(attr);
      }
    }

    if (attribs.length || path.node.children.length) {
      attribs = buildJSXOpeningElementAttributes(
        attribs,
        file,
        path.node.children,
      );
    } else {
      // attributes should never be null
      attribs = t.objectExpression([]);
    }

    args.push(attribs);

    if (!file.opts.development) {
      if (key !== undefined) {
        args.push(key);
      }
    } else {
      // isStaticChildren, __source, and __self are only used in development
      args.push(
        key === undefined ? t.identifier('undefined') : key,
        t.booleanLiteral(path.node.children.length > 1),
        source === undefined ? t.identifier('undefined') : source,
        self === undefined ? t.identifier('undefined') : self,
      );
    }

    if (opts.post) {
      opts.post(state, file);
    }

    return (
      state.call ||
      t.callExpression(
        path.node.children.length > 1 ? state.staticCallee : state.callee,
        args,
      )
    );
  }

  function isChildrenProp(prop) {
    return (
      t.isJSXAttribute(prop) &&
      t.isJSXIdentifier(prop.name) &&
      prop.name.name === 'children'
    );
  }

  // Builds props for React.jsx. This function adds children into the props
  // and ensures that props is always an object
  function buildJSXOpeningElementAttributes(attribs, file, children) {
    let _props = [];
    const objs = [];

    // In order to avoid having duplicate "children" keys, we avoid
    // pushing the "children" prop if we have actual children. However,
    // the children prop may have side effects, so to be certain
    // these side effects are evaluated, we add them to the following prop
    // as a sequence expression to preserve order. So:
    // <div children={x++} foo={y}>{child}</div> becomes
    // React.jsx('div', {foo: (x++, y), children: child});
    // duplicateChildren contains the extra children prop values
    let duplicateChildren = [];

    const hasChildren = children && children.length > 0;

    const useBuiltIns = file.opts.useBuiltIns || false;
    if (typeof useBuiltIns !== 'boolean') {
      throw new Error(
        'transform-react-jsx currently only accepts a boolean option for ' +
          'useBuiltIns (defaults to false)',
      );
    }

    while (attribs.length) {
      const prop = attribs.shift();
      if (hasChildren && isChildrenProp(prop)) {
        duplicateChildren.push(convertAttributeValue(prop.value));
      } else if (t.isJSXSpreadAttribute(prop)) {
        _props = pushProps(_props, objs);
        if (duplicateChildren.length > 0) {
          objs.push(
            t.sequenceExpression([...duplicateChildren, prop.argument]),
          );
          duplicateChildren = [];
        } else {
          objs.push(prop.argument);
        }
      } else {
        _props.push(convertAttribute(prop, duplicateChildren));
        if (duplicateChildren.length > 0) {
          duplicateChildren = [];
        }
      }
    }

    // In React.JSX, children is no longer a separate argument, but passed in
    // through the argument object
    if (hasChildren) {
      if (children.length === 1) {
        _props.push(
          t.objectProperty(
            t.identifier('children'),
            duplicateChildren.length > 0
              ? t.sequenceExpression([...duplicateChildren, children[0]])
              : children[0],
          ),
        );
      } else {
        _props.push(
          t.objectProperty(
            t.identifier('children'),
            duplicateChildren.length > 0
              ? t.sequenceExpression([
                  ...duplicateChildren,
                  t.arrayExpression(children),
                ])
              : t.arrayExpression(children),
          ),
        );
      }
    }

    pushProps(_props, objs);

    if (objs.length === 1) {
      // only one object
      if (!t.isObjectExpression(objs[0])) {
        // if the prop object isn't an object, use Object.assign or _extends
        // to ensure that the prop will always be an object (as opposed to a variable
        // that could be null at some point)
        const expressionHelper = useBuiltIns
          ? t.memberExpression(t.identifier('Object'), t.identifier('assign'))
          : file.addHelper('extends');

        attribs = t.callExpression(expressionHelper, [
          t.objectExpression([]),
          objs[0],
        ]);
      } else {
        attribs = objs[0];
      }
    } else {
      // looks like we have multiple objects
      if (!t.isObjectExpression(objs[0])) {
        objs.unshift(t.objectExpression([]));
      }

      const expressionHelper = useBuiltIns
        ? t.memberExpression(t.identifier('Object'), t.identifier('assign'))
        : file.addHelper('extends');

      // spread it
      attribs = t.callExpression(expressionHelper, objs);
    }

    return attribs;
  }

  // Builds JSX Fragment <></> into
  // Production: React.jsx(type, arguments)
  // Development: React.jsxDEV(type, { children})
  function buildJSXFragmentCall(path, file) {
    if (opts.filter && !opts.filter(path.node, file)) {
      return;
    }

    const openingPath = path.get('openingElement');
    openingPath.parent.children = t.react.buildChildren(openingPath.parent);

    const args = [];
    const tagName = null;
    const tagExpr = file.get('jsxFragIdentifier')();

    const state = {
      tagExpr: tagExpr,
      tagName: tagName,
      args: args,
    };

    if (opts.pre) {
      opts.pre(state, file);
    }

    let childrenNode;
    if (path.node.children.length > 0) {
      if (path.node.children.length === 1) {
        childrenNode = path.node.children[0];
      } else {
        childrenNode = t.arrayExpression(path.node.children);
      }
    }

    args.push(
      t.objectExpression(
        childrenNode !== undefined
          ? [t.objectProperty(t.identifier('children'), childrenNode)]
          : [],
      ),
    );

    if (file.opts.development) {
      args.push(
        t.identifier('undefined'),
        t.booleanLiteral(path.node.children.length > 1),
      );
    }

    if (opts.post) {
      opts.post(state, file);
    }

    return (
      state.call ||
      t.callExpression(
        path.node.children.length > 1 ? state.staticCallee : state.callee,
        args,
      )
    );
  }

  // Builds JSX into:
  // Production: React.createElement(type, arguments, children)
  // Development: React.createElement(type, arguments, children, source, self)
  function buildCreateElementCall(path, file) {
    if (opts.filter && !opts.filter(path.node, file)) {
      return;
    }

    const openingPath = path.get('openingElement');
    openingPath.parent.children = t.react.buildChildren(openingPath.parent);

    const tagExpr = convertJSXIdentifier(
      openingPath.node.name,
      openingPath.node,
    );
    const args = [];

    let tagName;
    if (t.isIdentifier(tagExpr)) {
      tagName = tagExpr.name;
    } else if (t.isLiteral(tagExpr)) {
      tagName = tagExpr.value;
    }

    const state = {
      tagExpr: tagExpr,
      tagName: tagName,
      args: args,
    };

    if (opts.pre) {
      opts.pre(state, file);
    }

    let attribs = openingPath.node.attributes;
    if (attribs.length) {
      attribs = buildCreateElementOpeningElementAttributes(attribs, file);
    } else {
      attribs = t.nullLiteral();
    }

    args.push(attribs, ...path.node.children);

    if (opts.post) {
      opts.post(state, file);
    }

    return state.call || t.callExpression(state.oldCallee, args);
  }

  function pushProps(_props, objs) {
    if (!_props.length) {
      return _props;
    }

    objs.push(t.objectExpression(_props));
    return [];
  }

  /**
   * The logic for this is quite terse. It's because we need to
   * support spread elements. We loop over all attributes,
   * breaking on spreads, we then push a new object containing
   * all prior attributes to an array for later processing.
   */
  function buildCreateElementOpeningElementAttributes(attribs, file) {
    let _props = [];
    const objs = [];

    const useBuiltIns = file.opts.useBuiltIns || false;
    if (typeof useBuiltIns !== 'boolean') {
      throw new Error(
        'transform-react-jsx currently only accepts a boolean option for ' +
          'useBuiltIns (defaults to false)',
      );
    }

    while (attribs.length) {
      const prop = attribs.shift();
      if (t.isJSXSpreadAttribute(prop)) {
        _props = pushProps(_props, objs);
        objs.push(prop.argument);
      } else {
        const attr = convertAttribute(prop);
        _props.push(attr);
      }
    }

    pushProps(_props, objs);

    if (objs.length === 1) {
      // only one object
      attribs = objs[0];
    } else {
      // looks like we have multiple objects
      if (!t.isObjectExpression(objs[0])) {
        objs.unshift(t.objectExpression([]));
      }

      const expressionHelper = useBuiltIns
        ? t.memberExpression(t.identifier('Object'), t.identifier('assign'))
        : file.addHelper('extends');

      // spread it
      attribs = t.callExpression(expressionHelper, objs);
    }

    return attribs;
  }
}

module.exports = function(babel) {
  const {types: t} = babel;

  const createIdentifierParser = id => () => {
    return id
      .split('.')
      .map(name => t.identifier(name))
      .reduce((object, property) => t.memberExpression(object, property));
  };

  const visitor = helper(babel, {
    pre(state) {
      const tagName = state.tagName;
      const args = state.args;
      if (t.react.isCompatTag(tagName)) {
        args.push(t.stringLiteral(tagName));
      } else {
        args.push(state.tagExpr);
      }
    },

    post(state, pass) {
      state.callee = pass.get('jsxIdentifier')();
      state.staticCallee = pass.get('jsxStaticIdentifier')();
      state.oldCallee = pass.get('oldJSXIdentifier')();
    },
  });

  const createIdentifierName = (path, autoImport, name, importName) => {
    if (autoImport === IMPORT_TYPES.none) {
      return `React.${name}`;
    } else if (autoImport === IMPORT_TYPES.namedExports) {
      if (importName) {
        const identifierName = `${importName[name]}`;
        return identifierName;
      }
    } else {
      return `${importName}.${name}`;
    }
  };

  function getImportNames(parentPath, state) {
    const imports = {};
    parentPath.traverse({
      JSXElement(path) {
        if (shouldUseCreateElement(path, t)) {
          imports.createElement = true;
        } else if (path.node.children.length > 1) {
          const importName = state.development ? 'jsxDEV' : 'jsxs';
          imports[importName] = true;
        } else {
          const importName = state.development ? 'jsxDEV' : 'jsx';
          imports[importName] = true;
        }
      },

      JSXFragment(path) {
        imports.Fragment = true;
      },
    });
    return imports;
  }

  function hasJSX(parentPath) {
    let fileHasJSX = false;
    parentPath.traverse({
      JSXElement(path) {
        fileHasJSX = true;
        path.stop();
      },

      JSXFragment(path) {
        fileHasJSX = true;
        path.stop();
      },
    });

    return fileHasJSX;
  }

  function addAutoImports(path, state) {
    if (state.autoImport === IMPORT_TYPES.none) {
      return;
    }

    if (IMPORT_TYPES[state.autoImport] === undefined) {
      throw path.buildCodeFrameError(
        'autoImport must be one of the following: ' +
          Object.keys(IMPORT_TYPES).join(', '),
      );
    }
    if (state.autoImport === IMPORT_TYPES.require && isModule(path)) {
      throw path.buildCodeFrameError(
        'Babel `sourceType` must be set to `script` for autoImport ' +
          'to use `require` syntax. See Babel `sourceType` for details.',
      );
    }
    if (state.autoImport !== IMPORT_TYPES.require && !isModule(path)) {
      throw path.buildCodeFrameError(
        'Babel `sourceType` must be set to `module` for autoImport to use `' +
          state.autoImport +
          '` syntax. See Babel `sourceType` for details.',
      );
    }

    // import {jsx} from "react";
    // import {createElement} from "react";
    if (state.autoImport === IMPORT_TYPES.namedExports) {
      const imports = getImportNames(path, state);
      const importMap = {};

      Object.keys(imports).forEach(importName => {
        importMap[importName] = addNamed(path, importName, state.source).name;
      });

      return importMap;
    }

    // add import to file and get the import name
    let name;
    if (state.autoImport === IMPORT_TYPES.require) {
      // var _react = require("react");
      name = addNamespace(path, state.source, {
        importedInterop: 'uncompiled',
      }).name;
    } else if (state.autoImport === IMPORT_TYPES.namespace) {
      // import * as _react from "react";
      name = addNamespace(path, state.source).name;
    } else if (state.autoImport === IMPORT_TYPES.defaultExport) {
      // import _default from "react";
      name = addDefault(path, state.source).name;
    }

    return name;
  }

  visitor.Program = {
    enter(path, state) {
      if (hasJSX(path)) {
        let autoImport = state.opts.autoImport || IMPORT_TYPES.none;
        let source = state.opts.importSource || 'react';
        const {file} = state;

        if (file.ast.comments) {
          for (let i = 0; i < file.ast.comments.length; i++) {
            const comment = file.ast.comments[i];
            const jsxAutoImportMatches = JSX_AUTO_IMPORT_ANNOTATION_REGEX.exec(
              comment.value,
            );
            if (jsxAutoImportMatches) {
              autoImport = jsxAutoImportMatches[1];
            }
            const jsxImportSourceMatches = JSX_IMPORT_SOURCE_ANNOTATION_REGEX.exec(
              comment.value,
            );
            if (jsxImportSourceMatches) {
              source = jsxImportSourceMatches[1];
            }
          }
        }

        const importName = addAutoImports(path, {
          ...state.opts,
          autoImport,
          source,
        });

        state.set(
          'oldJSXIdentifier',
          createIdentifierParser(
            createIdentifierName(path, autoImport, 'createElement', importName),
          ),
        );

        state.set(
          'jsxIdentifier',
          createIdentifierParser(
            createIdentifierName(
              path,
              autoImport,
              state.opts.development ? 'jsxDEV' : 'jsx',
              importName,
            ),
          ),
        );

        state.set(
          'jsxStaticIdentifier',
          createIdentifierParser(
            createIdentifierName(
              path,
              autoImport,
              state.opts.development ? 'jsxDEV' : 'jsxs',
              importName,
            ),
          ),
        );

        state.set(
          'jsxFragIdentifier',
          createIdentifierParser(
            createIdentifierName(path, autoImport, 'Fragment', importName),
          ),
        );
      }
    },
  };

  visitor.JSXAttribute = function(path) {
    if (t.isJSXElement(path.node.value)) {
      path.node.value = t.jsxExpressionContainer(path.node.value);
    }
  };

  return {
    name: 'transform-react-jsx',
    visitor,
  };
};
