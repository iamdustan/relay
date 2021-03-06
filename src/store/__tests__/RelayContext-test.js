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

jest.dontMock('RelayContext');

require('configureForRelayOSS');

const GraphQLStoreQueryResolver = require('GraphQLStoreQueryResolver');
const Relay = require('Relay');
const RelayContext = require('RelayContext');
const RelayQueryResultObservable = require('RelayQueryResultObservable');
const RelayStoreData = require('RelayStoreData');
const RelayMutation = require('RelayMutation');
const RelayMutationTransaction = require('RelayMutationTransaction');
const RelayMutationQueue = require('RelayMutationQueue');
const RelayTestUtils = require('RelayTestUtils');

const readRelayQueryData = require('readRelayQueryData');

describe('RelayContext', () => {
  var relayContext;
  var filter;
  var dataIDs;
  var queries;
  var callback;
  var recordWriter;
  var queryRunner;

  var {getNode} = RelayTestUtils;

  beforeEach(() => {
    jest.resetModuleRegistry();

    const storeData = new RelayStoreData();
    relayContext = new RelayContext(storeData);

    filter = () => true;
    dataIDs = ['feedback_id', 'likers_id'];
    queries = {};
    callback = jest.genMockFunction();
    queryRunner = storeData.getQueryRunner();
    recordWriter = storeData.getRecordWriter();
  });

  describe('primeCache', () => {
    it('invokes `GraphQLQueryRunner#run`', () => {
      relayContext.primeCache(queries, callback);

      expect(queryRunner.run).toBeCalled();
      expect(queryRunner.run.mock.calls[0][0]).toBe(queries);
      expect(queryRunner.run.mock.calls[0][1]).toBe(callback);
    });
  });

  describe('forceFetch', () => {
    it('invokes `GraphQLQueryRunner#forceFetch`', () => {
      relayContext.forceFetch(queries, callback);

      expect(queryRunner.forceFetch).toBeCalled();
      expect(queryRunner.forceFetch.mock.calls[0][0]).toBe(queries);
      expect(queryRunner.forceFetch.mock.calls[0][1]).toBe(callback);
    });
  });

  describe('read', () => {
    it('invokes `readRelayQueryData`', () => {
      relayContext.read(queries, dataIDs[0]);
      expect(readRelayQueryData).toBeCalled();
      expect(readRelayQueryData.mock.calls[0][1]).toEqual(queries);
      expect(readRelayQueryData.mock.calls[0][2]).toBe(dataIDs[0]);
      expect(readRelayQueryData.mock.calls[0][3]).toBeUndefined();
    });

    it('invokes `readRelayQueryData` with a filter', () => {
      relayContext.read(queries, dataIDs[0], filter);
      expect(readRelayQueryData).toBeCalled();
      expect(readRelayQueryData.mock.calls[0][3]).toBe(filter);
    });
  });

  describe('readAll', () => {
    it('invokes `readRelayQueryData`', () => {
      relayContext.readAll(queries, dataIDs);
      expect(readRelayQueryData.mock.calls.length).toBe(dataIDs.length);
      expect(readRelayQueryData.mock.calls.map(call => call[2])).toEqual(
        dataIDs
      );
    });

    it('invokes `readRelayQueryData` with a filter', () => {
      relayContext.readAll(queries, dataIDs, filter);
      expect(readRelayQueryData.mock.calls.length).toBe(dataIDs.length);
      readRelayQueryData.mock.calls.forEach((call) => {
        expect(call[3]).toBe(filter);
      });
    });
  });

  describe('readQuery', () => {
    it('accepts a query with no arguments', () => {
      recordWriter.putDataID('viewer', null, 'client:1');
      relayContext.readQuery(getNode(Relay.QL`query{viewer{actor{id}}}`));
      expect(readRelayQueryData.mock.calls.length).toBe(1);
      expect(readRelayQueryData.mock.calls[0][2]).toBe('client:1');
    });

    it('accepts a query with arguments', () => {
      relayContext.readQuery(getNode(Relay.QL`
        query {
          nodes(ids:["123","456"]) {
            id
          }
        }
      `));
      expect(readRelayQueryData.mock.calls.length).toBe(2);
      expect(readRelayQueryData.mock.calls[0][2]).toBe('123');
      expect(readRelayQueryData.mock.calls[1][2]).toBe('456');
    });

    it('accepts a query with unrecognized arguments', () => {
      var result = relayContext.readQuery(getNode(Relay.QL`
        query {
          username(name:"foo") {
            id
          }
        }
      `));
      expect(readRelayQueryData.mock.calls.length).toBe(0);
      expect(result).toEqual([undefined]);
    });
  });

  describe('observe', () => {
    it('instantiates RelayQueryResultObservable', () => {
      var fragment = getNode(Relay.QL`
        fragment on Node {
          id
        }
      `);
      GraphQLStoreQueryResolver.mockDefaultResolveImplementation(pointer => {
        expect(pointer.getFragment()).toBe(fragment);
        expect(pointer.getDataID()).toBe('123');
        return {
          __dataID__: '123',
          id: '123',
        };
      });

      var observer = relayContext.observe(fragment, '123');
      var onNext = jest.genMockFunction();
      expect(observer instanceof RelayQueryResultObservable).toBe(true);
      observer.subscribe({onNext});
      expect(onNext).toBeCalledWith({
        __dataID__: '123',
        id: '123',
      });
    });
  });

  describe('update functions', () => {
    var mockMutation, createTransactionMock, mockTransaction, mockCallbacks;

    beforeEach(() => {
      mockTransaction = new RelayMutationTransaction();
      mockTransaction.commit = jest.genMockFunction();
      createTransactionMock = jest.genMockFunction();
      createTransactionMock.mockReturnValue(mockTransaction);
      RelayMutationQueue.prototype.createTransaction = createTransactionMock;
      mockMutation = new RelayMutation();
      mockCallbacks = jest.genMockFunction();
    });

    describe('applyUpdate', () => {
      it('creates a new RelayMutationTransaction without committing it', () => {
        const transaction =
          relayContext.applyUpdate(mockMutation, mockCallbacks);
        expect(transaction).toEqual(mockTransaction);
        expect(createTransactionMock).toBeCalledWith(
          mockMutation,
          mockCallbacks
        );
        expect(mockTransaction.commit).not.toBeCalled();
      });
    });

    describe('commitUpdate', () => {
      it('creates a new RelayMutationTransaction and commits it', () => {
        relayContext.commitUpdate(mockMutation, mockCallbacks);
        expect(createTransactionMock).toBeCalledWith(
          mockMutation,
          mockCallbacks
        );
        expect(mockTransaction.commit).toBeCalled();
      });
    });

  });
});
