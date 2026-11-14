import { Comment } from "../models/Comment.js";
import { Discussion } from "../models/Discussion.js";
import { Issue } from "../models/Issue.js";
import { Knowledge } from "../models/Knowledge.js";
import { User } from "../models/User.js";

const PUBLIC_ACTOR_FIELDS = { _id: 1, name: 1, role: 1 };

function commentStatsLookup() {
  return {
    $lookup: {
      from: Comment.collection.name,
      let: { targetId: "$_id", commentRefType: "$commentRefType" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$refType", "$$commentRefType"] },
                { $eq: ["$refId", "$$targetId"] },
              ],
            },
          },
        },
        { $sort: { createdAt: -1, _id: -1 } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            latestCommentAt: { $first: "$createdAt" },
          },
        },
      ],
      as: "commentStats",
    },
  };
}

function normalizeCommentStats() {
  return {
    $set: {
      commentCount: {
        $ifNull: [{ $arrayElemAt: ["$commentStats.count", 0] }, 0],
      },
      latestCommentAt: {
        $arrayElemAt: ["$commentStats.latestCommentAt", 0],
      },
    },
  };
}

function discussionPipeline() {
  return [
    { $match: { status: "ACTIVE" } },
    {
      $set: {
        sourceType: "DISCUSSION",
        commentRefType: "DISCUSSION",
        resourceObjectId: "$_id",
        category: "$category",
        actorId: "$author",
      },
    },
    commentStatsLookup(),
    normalizeCommentStats(),
    {
      $set: {
        activityAt: { $ifNull: ["$latestCommentAt", "$createdAt"] },
      },
    },
    {
      $project: {
        _id: 0,
        sourceType: 1,
        resourceObjectId: 1,
        activityAt: 1,
        title: 1,
        category: 1,
        commentCount: 1,
        actorId: 1,
      },
    },
  ];
}

function issuePipeline() {
  return [
    {
      $set: {
        sourceType: "ISSUE",
        commentRefType: "ISSUE",
        resourceObjectId: "$_id",
        category: "$category",
        actorId: "$reportedBy",
      },
    },
    commentStatsLookup(),
    normalizeCommentStats(),
    { $match: { commentCount: { $gt: 0 } } },
    { $set: { activityAt: "$latestCommentAt" } },
    {
      $project: {
        _id: 0,
        sourceType: 1,
        resourceObjectId: 1,
        activityAt: 1,
        title: 1,
        category: 1,
        commentCount: 1,
        actorId: 1,
      },
    },
  ];
}

function knowledgePipeline() {
  return [
    { $match: { status: "approved" } },
    {
      $set: {
        sourceType: "KNOWLEDGE",
        commentRefType: "WIKI",
        resourceObjectId: "$_id",
        category: null,
        actorId: "$author",
      },
    },
    commentStatsLookup(),
    normalizeCommentStats(),
    { $match: { commentCount: { $gt: 0 } } },
    { $set: { activityAt: "$latestCommentAt" } },
    {
      $project: {
        _id: 0,
        sourceType: 1,
        resourceObjectId: 1,
        activityAt: 1,
        title: 1,
        category: 1,
        commentCount: 1,
        actorId: 1,
      },
    },
  ];
}

/**
 * Derived Community Activity read model.
 *
 * All source filtering, latest-comment selection, comment counting, merging,
 * ordering, pagination, and total calculation happen inside one MongoDB
 * aggregation. The application never materializes the eligible source
 * population or performs a per-item query loop.
 */
export async function listCommunityActivity({ page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;

  const pipeline = [
    ...discussionPipeline(),
    {
      $unionWith: {
        coll: Issue.collection.name,
        pipeline: issuePipeline(),
      },
    },
    {
      $unionWith: {
        coll: Knowledge.collection.name,
        pipeline: knowledgePipeline(),
      },
    },
    {
      $sort: {
        activityAt: -1,
        sourceType: 1,
        resourceObjectId: -1,
      },
    },
    {
      $facet: {
        items: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: User.collection.name,
              localField: "actorId",
              foreignField: "_id",
              pipeline: [{ $project: PUBLIC_ACTOR_FIELDS }],
              as: "actor",
            },
          },
          { $set: { actor: { $arrayElemAt: ["$actor", 0] } } },
          {
            $project: {
              _id: 0,
              id: {
                $concat: [
                  { $toLower: "$sourceType" },
                  ":",
                  { $toString: "$resourceObjectId" },
                ],
              },
              type: "$sourceType",
              activityAt: 1,
              title: 1,
              category: 1,
              commentCount: 1,
              resource: {
                type: "$sourceType",
                id: { $toString: "$resourceObjectId" },
              },
              author: {
                $cond: [
                  { $ne: ["$actor", null] },
                  {
                    _id: { $toString: "$actor._id" },
                    name: "$actor.name",
                    role: "$actor.role",
                  },
                  null,
                ],
              },
            },
          },
        ],
        total: [{ $count: "value" }],
      },
    },
  ];

  const [result] = await Discussion.aggregate(pipeline);
  const total = result?.total?.[0]?.value ?? 0;

  return {
    items: result?.items ?? [],
    page,
    limit,
    total,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}
