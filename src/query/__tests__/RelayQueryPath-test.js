/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @emails oncall+relay
 */

'use strict';

require('configureForRelayOSS');

const Relay = require('Relay');
const RelayQueryPath = require('RelayQueryPath');
const RelayTestUtils = require('RelayTestUtils');

describe('RelayQueryPath', () => {
  const {getNode} = RelayTestUtils;

  beforeEach(() => {
    jest.resetModuleRegistry();

    jasmine.addMatchers(RelayTestUtils.matchers);
  });

  it('creates root paths', () => {
    const query = getNode(Relay.QL`
      query {
        node(id:"123") {
          id
        }
      }
    `);
    const fragment = Relay.QL`
      fragment on Node {
        name
      }
    `;

    const path = new RelayQueryPath(query);
    expect(path.getName()).toBe(query.getName());

    const pathQuery = path.getQuery(getNode(fragment));
    expect(pathQuery).toEqualQueryRoot(getNode(Relay.QL`
      query {
        node(id:"123") {
          id,
          __typename,
          ${fragment},
        }
      }
    `));
  });

  it('creates root paths for argument-less root calls with IDs', () => {
    const query = getNode(Relay.QL`
      query {
        me {
          id
        }
      }
    `);
    const fragment = Relay.QL`
      fragment on Actor {
        name
      }
    `;
    const path = new RelayQueryPath(query);
    expect(path.getQuery(getNode(fragment))).toEqualQueryRoot(getNode(Relay.QL`
      query {
        me {
          id,
          ${fragment},
        }
      }
    `));
    expect(path.getName()).toBe(query.getName());
  });

  it('creates root paths for argument-less root calls without IDs', () => {
    const query = getNode(Relay.QL`
      query {
        viewer {
          actor {
            id
          }
        }
      }
    `);
    const fragment = Relay.QL`
      fragment on Viewer {
        actor {
          name
        }
      }
    `;
    const path = new RelayQueryPath(query);
    expect(path.getQuery(getNode(fragment))).toEqualQueryRoot(getNode(Relay.QL`
      query {
        viewer {
          ${fragment},
        }
      }
    `));
    expect(path.getName()).toBe(query.getName());
  });

  it('creates paths to non-refetchable fields', () => {
    const query = getNode(Relay.QL`
      query {
        node(id:"123") {
          id
        }
      }
    `);
    const address = getNode(Relay.QL`
      fragment on Actor {
        address {
          city
        }
      }
    `).getFieldByStorageKey('address');
    const city = getNode(Relay.QL`
      fragment on StreetAddress {
        city
      }
    `).getFieldByStorageKey('city');

    // address is not refetchable, has client ID
    const root = new RelayQueryPath(query);
    const path = root.getPath(address, 'client:1');
    expect(path.getQuery(city)).toEqualQueryRoot(getNode(Relay.QL`
      query {
        node(id:"123") {
          id,
          address {
            city
          }
        }
      }
    `));
    expect(path.getName()).toBe(query.getName());
  });

  it('creates roots for refetchable fields', () => {
    const query = getNode(Relay.QL`
      query {
        viewer {
          actor {
            id
          }
        }
      }
    `);
    const actor = query.getFieldByStorageKey('actor');
    const fragment = Relay.QL`
      fragment on Node {
        name
      }
    `;

    // actor has an ID and is refetchable
    const root = new RelayQueryPath(query);
    const path = root.getPath(actor, '123');
    expect(path.getQuery(getNode(fragment))).toEqualQueryRoot(getNode(Relay.QL`
      query {
        node(id:"123") {
          ${fragment},
        }
      }
    `));
    expect(path.getName()).toBe(query.getName());
  });
});
