/*
 * Copyright © 2018 Lisk Foundation
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Unless otherwise agreed in a custom licensing agreement with the Lisk Foundation,
 * no part of this software, including this file, may be copied, modified,
 * propagated, or distributed except according to the terms contained in the
 * LICENSE file.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

'use strict';

var Promise = require('bluebird');
var utils = require('../../utils');

module.exports = function(params) {
	function getAllPeers() {
		return Promise.all(
			params.sockets.map(socket => {
				return socket.call('list', {});
			})
		);
	}

	function getPeersStatus(peers) {
		return Promise.all(
			peers.map(peer => {
				return utils.http.getNodeStatus(peer.httpPort, peer.ip);
			})
		);
	}

	function getNodesStatus(cb) {
		getAllPeers()
			.then(peers => {
				var peersCount = peers.length;
				getPeersStatus(peers)
					.then(peerStatusList => {
						var networkMaxAvgHeight = getMaxAndAvgHeight(peerStatusList);
						var status = {
							peersCount,
							peerStatusList,
							networkMaxAvgHeight,
						};
						cb(null, status);
					})
					.catch(err => {
						cb(err, null);
					});
			})
			.catch(err => {
				cb(err, null);
			});
	}

	function getMaxAndAvgHeight(peerStatusList) {
		var maxHeight = 1;
		var heightSum = 0;
		var totalPeers = peerStatusList.length;
		peerStatusList.forEach(peerStatus => {
			if (peerStatus.height > maxHeight) {
				maxHeight = peerStatus.height;
			}
			heightSum += peerStatus.height;
		});

		return {
			maxHeight,
			averageHeight: heightSum / totalPeers,
		};
	}

	describe('Peers', () => {
		describe('mutual connections', () => {
			it('should return a list of peers mutually interconnected', () => {
				return getAllPeers().then(mutualPeers => {
					mutualPeers.forEach(mutualPeer => {
						expect(mutualPeer).to.have.property('success').to.be.true;
						expect(mutualPeer)
							.to.have.property('peers')
							.to.be.an('array');
						var peerPorts = mutualPeer.peers.map(peer => {
							return peer.wsPort;
						});
						var allPorts = params.configurations.map(configuration => {
							return configuration.wsPort;
						});
						expect(_.intersection(allPorts, peerPorts)).to.be.an('array').and
							.not.to.be.empty;
					});
				});
			});
		});

		describe('forging', () => {
			before(done => {
				// Expect some blocks to forge after 30 seconds
				var timesToCheckNetworkStatus = 30;
				var timesNetworkStatusChecked = 0;
				var checkNetworkStatusInterval = 1000;

				var checkingInterval = setInterval(() => {
					getNodesStatus((err, data) => {
						var { networkMaxAvgHeight } = data;
						timesNetworkStatusChecked += 1;
						if (err) {
							clearInterval(checkingInterval);
							return done(err);
						}
						utils.logger.log(
							`network status: height - ${
								networkMaxAvgHeight.maxHeight
							}, average height - ${networkMaxAvgHeight.averageHeight}`
						);
						if (timesNetworkStatusChecked === timesToCheckNetworkStatus) {
							clearInterval(checkingInterval);
							return done(null, networkMaxAvgHeight);
						}
					});
				}, checkNetworkStatusInterval);
			});

			describe('network status after 30 seconds', () => {
				var getNodesStatusError;
				var networkHeight;
				var networkAverageHeight;
				var peersCount;
				var peerStatusList;

				before(done => {
					getNodesStatus((err, data) => {
						getNodesStatusError = err;
						peersCount = data.peersCount;
						peerStatusList = data.peerStatusList;
						networkHeight = data.networkMaxAvgHeight.maxHeight;
						networkAverageHeight = data.networkMaxAvgHeight.averageHeight;
						done();
					});
				});

				it('should have no error', () => {
					return expect(getNodesStatusError).not.to.exist;
				});

				it('should have height > 1', () => {
					return expect(networkHeight).to.be.above(1);
				});

				it('should have average height above 1', () => {
					return expect(networkAverageHeight).to.be.above(1);
				});

				it('should have different peers heights propagated correctly on peers lists', () => {
					return getAllPeers().then(results => {
						expect(
							results.some(peersList => {
								return peersList.peers.some(peer => {
									return peer.height > 1;
								});
							})
						);
					});
				});

				describe('network height', () => {
					it('should have networkHeight > 1 for all peers', () => {
						expect(peerStatusList)
							.to.be.an('Array')
							.to.have.lengthOf(peersCount);
						return expect(
							peerStatusList.forEach(peer => {
								expect(peer.networkHeight).to.be.above(1);
							})
						);
					});

					it('should be same for all the peers', () => {
						var networkHeights = _.groupBy(peerStatusList, 'networkHeight');
						var heights = Object.keys(networkHeights);
						return expect(heights).to.have.lengthOf(1);
					});
				});
			});
		});
	});
};
