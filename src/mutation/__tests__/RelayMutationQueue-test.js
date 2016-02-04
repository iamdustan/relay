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
  .dontMock('RelayMutationTransaction')
  .dontMock('RelayMutationTransactionStatus');

const Relay = require('Relay');
const RelayConnectionInterface = require('RelayConnectionInterface');
const RelayMutation = require('RelayMutation');
const RelayMutationQuery = require('RelayMutationQuery');
const RelayMutationTransactionStatus = require('RelayMutationTransactionStatus');
const RelayStoreData = require('RelayStoreData');

const flattenRelayQuery = require('flattenRelayQuery');
const fromGraphQL = require('fromGraphQL');

describe('RelayMutationQueue', () => {
  let RelayNetworkLayer;
  let storeData;
  let mutationQueue;

  beforeEach(() => {
    jest.resetModuleRegistry();

    RelayNetworkLayer = jest.genMockFromModule('RelayNetworkLayer');
    jest.setMock('RelayNetworkLayer', RelayNetworkLayer);

    RelayStoreData.prototype.handleUpdatePayload = jest.genMockFunction();
    storeData = RelayStoreData.getDefaultInstance();
    mutationQueue = storeData.getMutationQueue();
  });

  describe('constructor', () => {
    let mockMutation, mutationNode, fatQuery;

    beforeEach(() => {
      mutationNode = Relay.QL`mutation{commentCreate(input:$input)}`;
      fatQuery = Relay.QL`fragment on Comment @relay(pattern: true) {
        ... on Comment {
          likers
          doesViewerLike
        }
      }`;
      mockMutation = new RelayMutation();
      mockMutation.getFatQuery.mockReturnValue(fatQuery);
      mockMutation.getMutation.mockReturnValue(mutationNode);
      mockMutation.getConfigs.mockReturnValue('configs');
    });

    it('does not update store if there is no optimistic response', () => {
      const transaction = mutationQueue.createTransaction(mockMutation);

      expect(transaction.getStatus()).toBe(
        RelayMutationTransactionStatus.UNCOMMITTED
      );
      expect(storeData.handleUpdatePayload).not.toBeCalled();
    });

    it('updates store if there is a optimistic response', () => {
      const input = {foo: 'bar'};
      mockMutation.getVariables.mockReturnValue(input);
      mockMutation.getOptimisticResponse.mockReturnValue({});
      mockMutation.getOptimisticConfigs.mockReturnValue('optimisticConfigs');
      RelayMutationQuery.buildQuery.mockReturnValue('optimisticQuery');

      const transaction = mutationQueue.createTransaction(mockMutation);

      expect(transaction.getStatus()).toBe(
        RelayMutationTransactionStatus.UNCOMMITTED
      );
      expect(RelayMutationQuery.buildQuery.mock.calls).toEqual([[{
        configs: 'optimisticConfigs',
        fatQuery: flattenRelayQuery(fromGraphQL.Fragment(fatQuery), {
          preserveEmptyNodes: true,
          shouldRemoveFragments: true,
        }),
        input: {
          ...input,
          [RelayConnectionInterface.CLIENT_MUTATION_ID]: '0',
        },
        mutation: mutationNode,
        mutationName: 'RelayMutation',
        tracker: storeData.getQueryTracker(),
      }]]);
      expect(storeData.handleUpdatePayload.mock.calls).toEqual([[
        'optimisticQuery',
        {[RelayConnectionInterface.CLIENT_MUTATION_ID]: '0'},
        {configs: 'optimisticConfigs', isOptimisticUpdate: true},
      ]]);
    });

    it('infers optimistic query if mutation does not have one', () => {
      mockMutation.getOptimisticResponse.mockReturnValue({});
      RelayMutationQuery.buildQueryForOptimisticUpdate.mockReturnValue(
        'optimisticQuery'
      );

      mutationQueue.createTransaction(mockMutation);

      expect(
        RelayMutationQuery.buildQueryForOptimisticUpdate.mock.calls
      ).toEqual([[{
        fatQuery: flattenRelayQuery(fromGraphQL.Fragment(fatQuery), {
          preserveEmptyNodes: true,
          shouldRemoveFragments: true,
        }),
        mutation: mutationNode,
        response: {
          [RelayConnectionInterface.CLIENT_MUTATION_ID]: '0',
        },
        tracker: storeData.getQueryTracker(),
      }]]);
      expect(storeData.handleUpdatePayload.mock.calls).toEqual([[
        'optimisticQuery',
        {[RelayConnectionInterface.CLIENT_MUTATION_ID]: '0'},
        {configs: 'configs', isOptimisticUpdate: true},
      ]]);
    });
  });

  describe('commit', () => {
    let mockMutation1, mockMutation2, mockMutation3, mutationNode, fatQuery;

    beforeEach(() => {
      fatQuery = Relay.QL`fragment on Comment @relay(pattern: true) {
        ... on Comment {
          doesViewerLike
        }
      }`;
      mutationNode = Relay.QL`mutation{commentCreate(input:$input)}`;

      RelayMutation.prototype.getFatQuery.mockReturnValue(fatQuery);
      RelayMutation.prototype.getMutation.mockReturnValue(mutationNode);
      RelayMutation.prototype.getCollisionKey.mockReturnValue(null);
      RelayMutation.prototype.getVariables.mockReturnValue({});
      RelayMutation.prototype.getConfigs.mockReturnValue('configs');

      mockMutation1 = new RelayMutation();
      mockMutation2 = new RelayMutation();
      mockMutation3 = new RelayMutation();
      mockMutation1.getCollisionKey.mockReturnValue('key');
      mockMutation2.getCollisionKey.mockReturnValue('anotherKey');
    });

    it('throws if commit is called more than once', () => {
      const transaction = mutationQueue.createTransaction(mockMutation1);
      transaction.commit();
      expect(() => transaction.commit()).toThrowError(
        'RelayMutationTransaction: Only transactions with status ' +
        '`UNCOMMITTED` can be comitted.'
      );
    });

    it('calls `onSuccess` with response', () => {
      const successCallback1 = jest.genMockFunction();
      const transaction1 = mutationQueue.createTransaction(
        mockMutation1,
        {onSuccess: successCallback1}
      );
      transaction1.commit();
      expect(RelayNetworkLayer.sendMutation.mock.calls.length).toBe(1);

      const request = RelayNetworkLayer.sendMutation.mock.calls[0][0];
      request.resolve({response: {'res': 'ponse'}});
      jest.runAllTimers();
      expect(successCallback1.mock.calls).toEqual([[{'res': 'ponse'}]]);
    });

    it('calls `onFailure` with transaction', () => {
      const failureCallback1 = jest.genMockFunction().mockImplementation(
        transaction => {
          expect(transaction).toBe(transaction1);
          expect(transaction.getError()).toBe(mockError);
        }
      );
      const transaction1 = mutationQueue.createTransaction(
        mockMutation1,
        {onFailure: failureCallback1}
      );
      const mockError = new Error('error');
      transaction1.commit();

      expect(RelayNetworkLayer.sendMutation.mock.calls.length).toBe(1);
      const request = RelayNetworkLayer.sendMutation.mock.calls[0][0];
      request.reject(mockError);
      jest.runAllTimers();
      expect(failureCallback1).toBeCalled();
    });

    it('queues commits for colliding transactions', () => {
      const successCallback1 = jest.genMockFunction();
      const transaction1 = mutationQueue.createTransaction(
        mockMutation1,
        {onSuccess: successCallback1}
      );
      transaction1.commit();

      expect(transaction1.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMITTING
      );

      const transaction2 = mutationQueue.createTransaction(mockMutation1);
      transaction2.commit();

      expect(transaction2.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMIT_QUEUED
      );
      expect(RelayNetworkLayer.sendMutation.mock.calls.length).toBe(1);

      const request = RelayNetworkLayer.sendMutation.mock.calls[0][0];
      request.resolve({response: {}});
      jest.runAllTimers();

      expect(successCallback1).toBeCalled();
      expect(transaction2.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMITTING
      );
      expect(RelayNetworkLayer.sendMutation.mock.calls.length).toBe(2);
    });

    it('does not queue commits for non-colliding transactions', () => {
      const transaction1 = mutationQueue.createTransaction(mockMutation1);
      transaction1.commit();

      expect(transaction1.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMITTING
      );
      expect(RelayNetworkLayer.sendMutation.mock.calls.length).toBe(1);

      const transaction2 = mutationQueue.createTransaction(mockMutation2);
      transaction2.commit();

      expect(transaction2.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMITTING
      );
      expect(RelayNetworkLayer.sendMutation.mock.calls.length).toBe(2);
    });

    it('does not queue commits for `null` collision key transactions', () => {
      const transaction1 = mutationQueue.createTransaction(mockMutation3);
      transaction1.commit();

      expect(transaction1.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMITTING
      );
      expect(RelayNetworkLayer.sendMutation.mock.calls.length).toBe(1);

      const transaction2 = mutationQueue.createTransaction(mockMutation3);
      transaction2.commit();

      expect(transaction2.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMITTING
      );
      expect(RelayNetworkLayer.sendMutation.mock.calls.length).toBe(2);
    });

    it('empties collision queue after a failure', () => {
      const failureCallback1 = jest.genMockFunction().mockImplementation(
        (transaction, preventAutoRollback) => {
          expect(transaction).toBe(transaction1);
          expect(transaction.getStatus()).toBe(
            RelayMutationTransactionStatus.COMMIT_FAILED
          );
        }
      );
      const transaction1 = mutationQueue.createTransaction(
        mockMutation1,
        {onFailure: failureCallback1}
      );
      transaction1.commit();

      expect(transaction1.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMITTING
      );
      expect(RelayNetworkLayer.sendMutation.mock.calls.length).toBe(1);

      const failureCallback2 = jest.genMockFunction().mockImplementation(
        (transaction, preventAutoRollback) => {
          expect(transaction).toBe(transaction2);
          expect(transaction.getStatus()).toBe(
            RelayMutationTransactionStatus.COLLISION_COMMIT_FAILED
          );

          preventAutoRollback();
        }
      );
      const transaction2 = mutationQueue.createTransaction(
        mockMutation1,
        {onFailure: failureCallback2}
      );
      transaction2.commit();

      expect(transaction2.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMIT_QUEUED
      );
      expect(RelayNetworkLayer.sendMutation.mock.calls.length).toBe(1);

      const request = RelayNetworkLayer.sendMutation.mock.calls[0][0];
      request.reject(new Error('error'));
      jest.runAllTimers();

      expect(failureCallback1).toBeCalled();
      expect(failureCallback2).toBeCalled();
      expect(() => transaction1.getStatus()).toThrowError(
        'RelayMutationQueue: `0` is not a valid pending transaction ID.'
      );
      expect(transaction2.getStatus()).toBe(
        RelayMutationTransactionStatus.COLLISION_COMMIT_FAILED
      );

      const transaction3 = mutationQueue.createTransaction(mockMutation1);
      transaction3.commit();

      expect(transaction3.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMITTING
      );
      expect(RelayNetworkLayer.sendMutation.mock.calls.length).toBe(2);
    });

    it('rolls back colliding transactions on failure unless prevented', () => {
      const failureCallback1 = jest.genMockFunction().mockImplementation(
        (transaction, preventAutoRollback) => {
          expect(transaction).toBe(transaction1);
          expect(transaction.getStatus()).toBe(
            RelayMutationTransactionStatus.COMMIT_FAILED
          );
          preventAutoRollback();
        }
      );
      const transaction1 = mutationQueue.createTransaction(
        mockMutation1,
        {onFailure: failureCallback1}
      );
      transaction1.commit();

      const failureCallback2 = jest.genMockFunction().mockImplementation(
        (transaction, preventAutoRollback) => {
          expect(transaction).toBe(transaction2);
          expect(transaction.getStatus()).toBe(
            RelayMutationTransactionStatus.COLLISION_COMMIT_FAILED
          );
        }
      );
      const transaction2 = mutationQueue.createTransaction(
        mockMutation1,
        {onFailure: failureCallback2}
      );
      transaction2.commit();

      const failureCallback3 = jest.genMockFunction().mockImplementation(
        (transaction, preventAutoRollback) => {
          expect(transaction).toBe(transaction3);
          expect(transaction.getStatus()).toBe(
            RelayMutationTransactionStatus.COLLISION_COMMIT_FAILED
          );
          preventAutoRollback();
        }
      );
      const transaction3 = mutationQueue.createTransaction(
        mockMutation1,
        {onFailure: failureCallback3}
      );
      transaction3.commit();

      expect(transaction1.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMITTING
      );
      expect(transaction2.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMIT_QUEUED
      );
      expect(transaction3.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMIT_QUEUED
      );

      const failureCallback4 = jest.genMockFunction().mockImplementation();
      const transaction4 = mutationQueue.createTransaction(
        mockMutation2,
        {onFailure: failureCallback4}
      );
      transaction4.commit();

      const failureCallback5 = jest.genMockFunction().mockImplementation();
      const transaction5 = mutationQueue.createTransaction(
        mockMutation2,
        {onFailure: failureCallback5}
      );
      transaction5.commit();

      expect(transaction4.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMITTING
      );
      expect(transaction5.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMIT_QUEUED
      );
      expect(RelayNetworkLayer.sendMutation.mock.calls.length).toBe(2);

      const request = RelayNetworkLayer.sendMutation.mock.calls[0][0];
      request.reject(new Error('error'));
      jest.runAllTimers();

      expect(failureCallback1).toBeCalled();
      expect(failureCallback2).toBeCalled();
      expect(failureCallback3).toBeCalled();
      expect(failureCallback4).not.toBeCalled();
      expect(failureCallback5).not.toBeCalled();
      expect(transaction1.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMIT_FAILED
      );
      expect(() => transaction2.getStatus()).toThrowError(
        'RelayMutationQueue: `1` is not a valid pending transaction ID.'
      );
      expect(transaction3.getStatus()).toBe(
        RelayMutationTransactionStatus.COLLISION_COMMIT_FAILED
      );
      expect(transaction4.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMITTING
      );
      expect(transaction5.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMIT_QUEUED
      );
    });
  });

  describe('recommit', () => {
    let mockMutation, mutationNode, fatQuery;

    beforeEach(() => {
      fatQuery = Relay.QL`fragment on Comment @relay(pattern: true) {
        ... on Comment {
          doesViewerLike
        }
      }`;
      mutationNode = Relay.QL`mutation{commentCreate(input:$input)}`;
      RelayMutation.prototype.getFatQuery.mockReturnValue(fatQuery);
      RelayMutation.prototype.getMutation.mockReturnValue(mutationNode);
      RelayMutation.prototype.getCollisionKey.mockReturnValue('key');
      RelayMutation.prototype.getVariables.mockReturnValue({});
      RelayMutation.prototype.getConfigs.mockReturnValue('configs');

      mockMutation = new RelayMutation();
    });

    it('re-queues the transaction', () => {
      const successCallback1 = jest.genMockFunction();
      const failureCallback1 = jest.genMockFunction().mockImplementation(
        (transaction, preventAutoRollback) => {
          preventAutoRollback();
        }
      );
      const transaction1 = mutationQueue.createTransaction(
        mockMutation,
        {
          onSuccess: successCallback1,
          onFailure: failureCallback1,
        }
      );
      transaction1.commit();

      expect(RelayNetworkLayer.sendMutation.mock.calls.length).toBe(1);
      let request = RelayNetworkLayer.sendMutation.mock.calls[0][0];
      request.reject(new Error('error'));
      jest.runAllTimers();

      expect(failureCallback1).toBeCalled();
      expect(transaction1.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMIT_FAILED
      );

      const successCallback2 = jest.genMockFunction();
      const transaction2 = mutationQueue.createTransaction(
        mockMutation,
        {onSuccess: successCallback2}
      );
      transaction2.commit();

      expect(RelayNetworkLayer.sendMutation.mock.calls.length).toBe(2);

      transaction1.recommit();
      expect(transaction1.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMIT_QUEUED
      );

      request = RelayNetworkLayer.sendMutation.mock.calls[1][0];
      request.resolve({response: {}});
      jest.runAllTimers();
      expect(successCallback2).toBeCalled();

      expect(RelayNetworkLayer.sendMutation.mock.calls.length).toBe(3);
      expect(transaction1.getStatus()).toBe(
        RelayMutationTransactionStatus.COMMITTING
      );

      request = RelayNetworkLayer.sendMutation.mock.calls[2][0];
      request.resolve({response: {}});
      jest.runAllTimers();

      expect(successCallback1).toBeCalled();
    });
  });
});
