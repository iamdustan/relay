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
  .dontMock('GraphQLSegment')
  .dontMock('GraphQLStoreQueryResolver');

const GraphQLFragmentPointer = require('GraphQLFragmentPointer');
const GraphQLStoreQueryResolver = require('GraphQLStoreQueryResolver');
const Relay = require('Relay');
const RelayStoreData = require('RelayStoreData');
const RelayTestUtils = require('RelayTestUtils');

const readRelayQueryData = require('readRelayQueryData');
const transformRelayQueryPayload = require('transformRelayQueryPayload');

describe('GraphQLStoreQueryResolver', () => {
  let changeEmitter;
  let storeData;

  let mockCallback;
  let mockQueryFragment;
  let mockPluralQueryFragment;

  const {getNode} = RelayTestUtils;

  function mockReader(mockResult) {
    readRelayQueryData.mockImplementation((_, __, dataID) => {
      return {
        dataIDs: {[dataID]: true},
        data: mockResult[dataID],
      };
    });
  }

  beforeEach(() => {
    jest.resetModuleRegistry();

    storeData = new RelayStoreData();
    changeEmitter = storeData.getChangeEmitter();

    mockCallback = jest.genMockFunction();
    mockQueryFragment = getNode(Relay.QL`fragment on Node{id,name}`);
    mockPluralQueryFragment = getNode(Relay.QL`
      fragment on Node @relay(plural:true) {
        id,
        name,
      }
    `);

    jasmine.addMatchers(RelayTestUtils.matchers);
  });

  it('should resolve a pointer', () => {
    const fragmentPointer = new GraphQLFragmentPointer(
      '1038750002',
      mockQueryFragment
    );
    const mockResult = {__dataID__: '1038750002', id: '1038750002', name: 'Tim'};
    readRelayQueryData.mockReturnValue({data: mockResult});

    const resolver = new GraphQLStoreQueryResolver(
      storeData,
      fragmentPointer,
      mockCallback
    );
    const resolved = resolver.resolve(fragmentPointer);

    expect(resolved).toBe(mockResult);

    expect(readRelayQueryData).toBeCalled();
    expect(readRelayQueryData.mock.calls[0][1]).toBe(mockQueryFragment);
    expect(readRelayQueryData.mock.calls[0][2]).toEqual(
      fragmentPointer.getDataID()
    );
  });

  it('should subscribe to IDs in resolved pointer', () => {
    const fragmentPointer = new GraphQLFragmentPointer(
      '1038750002',
      mockQueryFragment
    );
    const mockResult = {
      '1038750002': {__dataID__: '1038750002', id: '1038750002', name: 'Tim'},
    };
    mockReader(mockResult);

    const resolver = new GraphQLStoreQueryResolver(
      storeData,
      fragmentPointer,
      mockCallback
    );
    resolver.resolve(fragmentPointer);

    const addListenersForIDs = changeEmitter.addListenerForIDs;
    expect(addListenersForIDs).toBeCalled();
    expect(addListenersForIDs.mock.calls[0][0]).toEqual(['1038750002']);
  });

  it('should not re-resolve pointers without change events', () => {
    const fragmentPointer = new GraphQLFragmentPointer(
      '1038750002',
      mockQueryFragment
    );
    const mockResultA = {__dataID__: '1038750002', id: '1038750002', name: 'Tim'};
    const mockResultB = {__dataID__: '1038750002', id: '1038750002', name: 'Tim'};

    const resolver = new GraphQLStoreQueryResolver(
      storeData,
      fragmentPointer,
      mockCallback
    );

    readRelayQueryData.mockReturnValue({data: mockResultA});
    const resolvedA = resolver.resolve(fragmentPointer);

    readRelayQueryData.mockReturnValue({data: mockResultB});
    const resolvedB = resolver.resolve(fragmentPointer);

    expect(readRelayQueryData.mock.calls.length).toBe(1);
    expect(resolvedA).toBe(resolvedB);
  });

  it('should re-resolve pointers with change events', () => {
    const fragmentPointer = new GraphQLFragmentPointer(
      '1038750002',
      mockQueryFragment
    );
    const mockResultA = {__dataID__: '1038750002', id: '1038750002', name: 'Tim'};
    const mockResultB = {__dataID__: '1038750002', id: '1038750002', name: 'Tee'};

    const resolver = new GraphQLStoreQueryResolver(
      storeData,
      fragmentPointer,
      mockCallback
    );

    mockReader({
      [mockResultA.id]: mockResultA,
    });
    const resolvedA = resolver.resolve(fragmentPointer);

    const callback = changeEmitter.addListenerForIDs.mock.calls[0][1];
    callback(['1038750002']);

    mockReader({
      [mockResultB.id]: mockResultB,
    });
    const resolvedB = resolver.resolve(fragmentPointer);

    expect(readRelayQueryData.mock.calls.length).toBe(2);
    expect(resolvedA).toBe(mockResultA);
    expect(resolvedB).toBe(mockResultB);
  });

  it('should re-resolve pointers whose calls differ', () => {
    const fragmentPointerA = new GraphQLFragmentPointer(
      'client:123_first(10)',
      mockQueryFragment
    );
    const fragmentPointerB = new GraphQLFragmentPointer(
      'client:123_first(20)',
      mockQueryFragment
    );

    const resolver = new GraphQLStoreQueryResolver(
      storeData,
      fragmentPointerA,
      mockCallback
    );

    require('GraphQLStoreRangeUtils').getCanonicalClientID =
      // The canonical ID of a range customarily excludes the calls
      jest.genMockFunction().mockReturnValue('client:123');

    resolver.resolve(fragmentPointerA);
    resolver.resolve(fragmentPointerB);

    expect(readRelayQueryData.mock.calls.length).toBe(2);
  });

  it('should invoke the callback when change events fire', () => {
    const fragmentPointer = new GraphQLFragmentPointer(
      '1038750002',
      mockQueryFragment
    );
    const mockResult = {
      '1038750002': {__dataID__: '1038750002', id: '1038750002', name: 'Tim'},
    };

    const resolver = new GraphQLStoreQueryResolver(
      storeData,
      fragmentPointer,
      mockCallback
    );

    mockReader(mockResult);
    resolver.resolve(fragmentPointer);

    const callback = changeEmitter.addListenerForIDs.mock.calls[0][1];
    callback(['1038750002']);

    expect(mockCallback).toBeCalled();
  });

  it('should resolve an array of pointers', () => {
    const fragmentPointer = new GraphQLFragmentPointer(
      ['1', '2'],
      mockPluralQueryFragment
    );
    const mockResults = {
      '1': {__dataID__: '1', name: 'One'},
      '2': {__dataID__: '2', name: 'Two'},
    };
    mockReader(mockResults);

    const resolver = new GraphQLStoreQueryResolver(
      storeData,
      fragmentPointer,
      mockCallback
    );

    const resolved = resolver.resolve(fragmentPointer);
    expect(resolved.length).toBe(2);
    expect(resolved[0]).toBe(mockResults['1']);
    expect(resolved[1]).toBe(mockResults['2']);

    expect(readRelayQueryData.mock.calls[0][2]).toEqual(
      fragmentPointer.getDataIDs()[0]
    );
    expect(readRelayQueryData.mock.calls[1][2]).toEqual(
      fragmentPointer.getDataIDs()[1]
    );
  });

  it('should not re-resolve if the pointer array has no changes', () => {
    const fragmentPointer = new GraphQLFragmentPointer(
      ['1', '2'],
      mockPluralQueryFragment
    );
    const mockResults = {
      '1': {__dataID__: '1', name: 'One'},
      '2': {__dataID__: '2', name: 'Two'},
    };
    mockReader(mockResults);

    const resolver = new GraphQLStoreQueryResolver(
      storeData,
      fragmentPointer,
      mockCallback
    );

    const resolvedA = resolver.resolve(fragmentPointer);
    const resolvedB = resolver.resolve(fragmentPointer);

    expect(resolvedA).toBe(resolvedB);
  });

  it('should only re-resolve pointers with changes in an array', () => {
    const fragmentPointer = new GraphQLFragmentPointer(
      ['1', '2'],
      mockPluralQueryFragment
    );
    const mockResults = {
      '1': {__dataID__: '1', name: 'One'},
      '2': {__dataID__: '2', name: 'Two'},
    };
    mockReader(mockResults);

    const resolver = new GraphQLStoreQueryResolver(
      storeData,
      fragmentPointer,
      mockCallback
    );

    const resolvedA = resolver.resolve(fragmentPointer);

    mockResults['1'] = {__dataID__: '1', name: 'Won'};
    const callback = changeEmitter.addListenerForIDs.mock.calls[0][1];
    callback(['1']);

    const resolvedB = resolver.resolve(fragmentPointer);

    expect(resolvedA).not.toBe(resolvedB);

    expect(resolvedB.length).toBe(2);
    expect(resolvedB[0]).toBe(mockResults['1']);
    expect(resolvedB[1]).toBe(mockResults['2']);

    expect(readRelayQueryData.mock.calls.length).toBe(3);
    expect(readRelayQueryData.mock.calls[2][2]).toEqual('1');
  });

  it('should create a new array if the pointer array shortens', () => {
    const fragmentPointer = new GraphQLFragmentPointer(
      ['1', '2'],
      mockPluralQueryFragment
    );
    const fragmentPointerB = new GraphQLFragmentPointer(
      ['1'],
      mockPluralQueryFragment
    );
    const mockResults = {
      '1': {__dataID__: '1', name: 'One'},
      '2': {__dataID__: '2', name: 'Two'},
    };
    mockReader(mockResults);

    const resolver = new GraphQLStoreQueryResolver(
      storeData,
      fragmentPointer,
      mockCallback
    );

    const resolvedA = resolver.resolve(fragmentPointer);
    const resolvedB = resolver.resolve(fragmentPointerB);

    expect(resolvedA).not.toBe(resolvedB);

    expect(resolvedA.length).toBe(2);
    expect(resolvedB.length).toBe(1);
  });

  describe('garbage collection', () => {
    let fragment;

    beforeEach(() => {
      storeData.initializeGarbageCollector(run => {
        while (run()) {}
      });
      const containerFragment = RelayTestUtils.createContainerFragment(Relay.QL`
        fragment on NewsFeedConnection {
          edges {
            node {
              id
            }
          }
        }
      `);
      fragment = Relay.QL`
        fragment on Viewer {
          actor {
            id
          }
          newsFeed(first: "1") {
            ${containerFragment}
          }
        }
      `;
      const query = getNode(Relay.QL`
        query {
          viewer {
            ${fragment}
          }
        }
      `);
      const payload = {
        viewer: {
          actor: {
            id: '123',
          },
          newsFeed: {
            edges: [
              {
                node: {
                  id: '456',
                },
              },
            ],
          },
        },
      };
      storeData.handleQueryPayload(
        query,
        transformRelayQueryPayload(query, payload),
        1
      );
    });

    it('increments references to read data', () => {
      const fragmentPointer = new GraphQLFragmentPointer(
        'client:1',
        getNode(fragment)
      );
      const queryResolver = new GraphQLStoreQueryResolver(
        storeData,
        fragmentPointer,
        jest.genMockFunction()
      );
      // read data and set up subscriptions
      queryResolver.resolve(fragmentPointer);
      // evict unreferenced nodes
      storeData.getGarbageCollector().collect();
      // nodes referenced by the fragment should not be evicted
      expect(Object.keys(storeData.getNodeData())).toEqual([
        '123',      // viewer.actor
        'client:1', // viewer
        'client:2', // viewer.newsFeed
      ]);
    });

    it('decrements references to previously read fields', () => {
      const fragmentPointer = new GraphQLFragmentPointer(
        'client:1',
        getNode(fragment)
      );
      const queryResolver = new GraphQLStoreQueryResolver(
        storeData,
        fragmentPointer,
        jest.genMockFunction()
      );
      // read data and increment GC ref counts
      queryResolver.resolve(fragmentPointer);
      const callback =
        storeData.getChangeEmitter().addListenerForIDs.mock.calls[0][1];

      // Remove the link to viewer.actor and broadcast an update
      storeData.getRecordWriter().putField('client:1', 'actor', null);
      storeData.getRecordWriter().putField('client:1', 'newsFeed', null);
      callback(['client:1']);

      // re-read and increment/decrement GC ref counts
      queryResolver.resolve(fragmentPointer);

      // evict unreferenced nodes
      storeData.getGarbageCollector().collect();
      // nodes referenced by the fragment should not be evicted
      expect(Object.keys(storeData.getNodeData())).toEqual([
        // '123' (actor) is unreferenced and collected
        // 'client:2' (viewer.newsFeed) is unreferenced and collected
        'client:1', // viewer
      ]);
    });

    it('decrements references when reset', () => {
      const fragmentPointer = new GraphQLFragmentPointer(
        'client:1',
        getNode(fragment)
      );
      const queryResolver = new GraphQLStoreQueryResolver(
        storeData,
        fragmentPointer,
        jest.genMockFunction()
      );
      // read data and increment GC ref counts
      queryResolver.resolve(fragmentPointer);
      // reset the resolver; should unreference all nodes
      queryResolver.reset();

      // evict unreferenced nodes
      storeData.getGarbageCollector().collect();
      // all nodes are unreferenced and should be removed
      expect(storeData.getNodeData()).toEqual({});
    });
  });
});
