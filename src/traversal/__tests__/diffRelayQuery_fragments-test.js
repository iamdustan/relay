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

jest
  .dontMock('GraphQLRange')
  .dontMock('GraphQLSegment');

const Relay = require('Relay');
const RelayConnectionInterface = require('RelayConnectionInterface');
const RelayQueryTracker = require('RelayQueryTracker');
const RelayTestUtils = require('RelayTestUtils');

const diffRelayQuery = require('diffRelayQuery');

describe('diffRelayQuery - fragments', () => {
  let RelayRecordStore;
  let RelayRecordWriter;

  const {getNode, writePayload} = RelayTestUtils;
  let HAS_NEXT_PAGE, HAS_PREV_PAGE, PAGE_INFO;

  const rootCallMap = {
    'viewer': {'': 'client:1'},
  };

  beforeEach(() => {
    jest.resetModuleRegistry();

    RelayRecordStore = require('RelayRecordStore');
    RelayRecordWriter = require('RelayRecordWriter');
    ({HAS_NEXT_PAGE, HAS_PREV_PAGE, PAGE_INFO} = RelayConnectionInterface);

    jasmine.addMatchers(RelayTestUtils.matchers);
  });

  it('removes matching fragments with fetched fields', () => {
    const records = {};
    const store = new RelayRecordStore({records});
    const writer = new RelayRecordWriter(records, {}, false);
    const tracker = new RelayQueryTracker();

    const query = getNode(Relay.QL`
      query {
        node(id:"123") {
          ... on User {
            firstName
          }
        }
      }
    `);
    const payload = {
      node: {
        id: '123',
        __typename: 'User',
        firstName: 'Joe',
      },
    };
    writePayload(store, writer, query, payload, tracker);

    const diffQueries = diffRelayQuery(query, store, tracker);
    expect(diffQueries.length).toBe(0);
  });

  it('refetches matching fragments with missing fields', () => {
    const records = {};
    const store = new RelayRecordStore({records});
    const writer = new RelayRecordWriter(records, {}, false);
    const tracker = new RelayQueryTracker();

    const query = getNode(Relay.QL`
      query {
        node(id:"123") {
          ... on User {
            firstName
            lastName
          }
        }
      }
    `);
    const payload = {
      node: {
        id: '123',
        __typename: 'User',
        firstName: 'Joe', // missing `lastName`
      },
    };
    writePayload(store, writer, query, payload, tracker);

    const diffQueries = diffRelayQuery(query, store, tracker);
    expect(diffQueries.length).toBe(1);
    expect(diffQueries[0]).toEqualQueryRoot(getNode(Relay.QL`
      query {
        node(id:"123") {
          ... on User {
            lastName
          }
        }
      }
    `));
  });

  it('removes non-matching fragments if other fields are fetched', () => {
    const records = {};
    const store = new RelayRecordStore({records});
    const writer = new RelayRecordWriter(records, {}, false);
    const tracker = new RelayQueryTracker();

    const query = getNode(Relay.QL`
      query {
        node(id:"123") {
          ... on User {
            firstName
          }
          ... on Page {
            name
          }
        }
      }
    `);
    const payload = {
      node: {
        id: '123',
        __typename: 'User',
        firstName: 'Joe',
      },
    };
    writePayload(store, writer, query, payload, tracker);

    const diffQueries = diffRelayQuery(query, store, tracker);
    expect(diffQueries.length).toBe(0);
  });

  it('refetches non-matching fragments if other fields are missing', () => {
    const records = {};
    const store = new RelayRecordStore({records});
    const writer = new RelayRecordWriter(records, {}, false);
    const tracker = new RelayQueryTracker();

    const query = getNode(Relay.QL`
      query {
        node(id:"123") {
          ... on User {
            firstName
            lastName
          }
          ... on Page {
            name
          }
        }
      }
    `);
    const payload = {
      node: {
        id: '123',
        __typename: 'User',
        firstName: 'Joe', // missing `lastName`
      },
    };
    writePayload(store, writer, query, payload, tracker);

    const diffQueries = diffRelayQuery(query, store, tracker);
    expect(diffQueries.length).toBe(1);
    expect(diffQueries[0]).toEqualQueryRoot(getNode(Relay.QL`
      query {
        node(id:"123") {
          ... on User {
            lastName
          }
          ... on Page {
            name
          }
        }
      }
    `));
  });

  it('removes non-matching fragments if connection fields are fetched', () => {
    const records = {};
    const store = new RelayRecordStore({records}, {rootCallMap});
    const writer = new RelayRecordWriter(records, rootCallMap, false);
    const tracker = new RelayQueryTracker();

    const payload = {
      viewer: {
        newsFeed: {
          edges: [
            {
              cursor: 'c1',
              node: {
                id: 's1',
                __typename: 'Story',
                message: {text: 's1'},
              },
            },
          ],
          [PAGE_INFO]: {
            [HAS_NEXT_PAGE]: true,
            [HAS_PREV_PAGE]: false,
          },
        },
      },
    };
    const query = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first:"1") {
            edges {
              node {
                ... on Story {
                  message {
                    text
                  }
                }
                ... on PhotoStory {
                  photo {
                    uri
                  }
                }
              }
            }
          }
        }
      }
    `);
    writePayload(store, writer, query, payload, tracker);

    const diffQueries = diffRelayQuery(query, store, tracker);
    expect(diffQueries.length).toBe(0);
  });

  it(
    'refetches non-matching fragments if connection fields are missing',
    () => {
      const records = {};
      const store = new RelayRecordStore({records}, {rootCallMap});
      const writer = new RelayRecordWriter(records, rootCallMap, false);
      const tracker = new RelayQueryTracker();

      const payload = {
        viewer: {
          newsFeed: {
            edges: [
              {
                cursor: 'c1',
                node: {
                  id: 's1',
                  __typename: 'Story',
                  message: {
                    text: 's1', // missing `ranges`
                  },
                },
              },
            ],
            [PAGE_INFO]: {
              [HAS_NEXT_PAGE]: true,
              [HAS_PREV_PAGE]: false,
            },
          },
        },
      };
      const query = getNode(Relay.QL`
        query {
          viewer {
            newsFeed(first:"1") {
              edges {
                node {
                  ... on Story {
                    message {
                      text
                      ranges
                    }
                  }
                  ... on PhotoStory {
                    photo {
                      uri
                    }
                  }
                }
              }
            }
          }
        }
      `);
      writePayload(store, writer, query, payload, tracker);

      const diffQueries = diffRelayQuery(query, store, tracker);
      expect(diffQueries.length).toBe(1);
      expect(diffQueries[0]).toEqualQueryRoot(getNode(Relay.QL`
      query {
        node(id:"s1") {
          ... on Story {
            message {
              ranges
            }
          }
          ... on PhotoStory {
            photo {
              uri
            }
          }
          ... on FeedUnit {
            id
            __typename
          }
        }
      }
    `));
    }
  );
});
