/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/agent_registry.json`.
 */
export type AgentRegistry = {
  "address": "CVwkvdnRgH4nwhySYFfousNBWGPT1TTrrFvz8R2fxrt6",
  "metadata": {
    "name": "agentRegistry",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "deactivateAgent",
      "discriminator": [
        205,
        171,
        239,
        225,
        82,
        126,
        96,
        166
      ],
      "accounts": [
        {
          "name": "agentProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "agent_profile.authority",
                "account": "agentProfile"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "agentProfile"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "recordSpending",
      "discriminator": [
        102,
        59,
        74,
        219,
        210,
        124,
        10,
        235
      ],
      "accounts": [
        {
          "name": "agentProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "agent_profile.authority",
                "account": "agentProfile"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "registerAgent",
      "discriminator": [
        135,
        157,
        66,
        195,
        2,
        113,
        175,
        30
      ],
      "accounts": [
        {
          "name": "agentProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "category",
          "type": "u8"
        },
        {
          "name": "description",
          "type": "string"
        },
        {
          "name": "pricingModelType",
          "type": "u8"
        },
        {
          "name": "pricingAmount",
          "type": "u64"
        },
        {
          "name": "capabilities",
          "type": {
            "vec": "string"
          }
        },
        {
          "name": "maxCap",
          "type": "u64"
        },
        {
          "name": "dailyCap",
          "type": "u64"
        },
        {
          "name": "totalCap",
          "type": "u64"
        }
      ]
    },
    {
      "name": "resetDailySpent",
      "discriminator": [
        162,
        18,
        89,
        96,
        191,
        119,
        181,
        10
      ],
      "accounts": [
        {
          "name": "agentProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "agent_profile.authority",
                "account": "agentProfile"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "agentProfile"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "updateAgent",
      "discriminator": [
        85,
        2,
        178,
        9,
        119,
        139,
        102,
        164
      ],
      "accounts": [
        {
          "name": "agentProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "agent_profile.authority",
                "account": "agentProfile"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "agentProfile"
          ]
        }
      ],
      "args": [
        {
          "name": "name",
          "type": {
            "option": "string"
          }
        },
        {
          "name": "description",
          "type": {
            "option": "string"
          }
        },
        {
          "name": "pricingModelType",
          "type": {
            "option": "u8"
          }
        },
        {
          "name": "pricingAmount",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "capabilities",
          "type": {
            "option": {
              "vec": "string"
            }
          }
        },
        {
          "name": "maxCap",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "dailyCap",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "totalCap",
          "type": {
            "option": "u64"
          }
        }
      ]
    },
    {
      "name": "verifyAgent",
      "discriminator": [
        206,
        212,
        108,
        12,
        105,
        61,
        100,
        66
      ],
      "accounts": [
        {
          "name": "agentProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "agent_profile.authority",
                "account": "agentProfile"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "agentProfile",
      "discriminator": [
        60,
        227,
        42,
        24,
        0,
        87,
        86,
        205
      ]
    }
  ],
  "events": [
    {
      "name": "agentRegistered",
      "discriminator": [
        191,
        78,
        217,
        54,
        232,
        100,
        189,
        85
      ]
    },
    {
      "name": "spendingRecorded",
      "discriminator": [
        243,
        16,
        218,
        177,
        69,
        2,
        91,
        179
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "nameTooLong",
      "msg": "Agent name must be 100 characters or less"
    },
    {
      "code": 6001,
      "name": "descriptionTooLong",
      "msg": "Agent description must be 500 characters or less"
    },
    {
      "code": 6002,
      "name": "invalidCategory",
      "msg": "Invalid category. Must be 0 (Geo), 1 (Politics), or 2 (Sports)"
    },
    {
      "code": 6003,
      "name": "tooManyCapabilities",
      "msg": "Too many capabilities. Maximum 10 allowed"
    },
    {
      "code": 6004,
      "name": "invalidMaxCap",
      "msg": "Max cap must be greater than 0"
    },
    {
      "code": 6005,
      "name": "invalidDailyCap",
      "msg": "Daily cap must be greater than 0"
    },
    {
      "code": 6006,
      "name": "invalidTotalCap",
      "msg": "Total cap must be >= max cap"
    },
    {
      "code": 6007,
      "name": "agentNotActive",
      "msg": "Agent is not active"
    },
    {
      "code": 6008,
      "name": "exceedsMaxCap",
      "msg": "Amount exceeds max cap per trade"
    },
    {
      "code": 6009,
      "name": "exceedsDailyCap",
      "msg": "Amount exceeds daily spending cap"
    },
    {
      "code": 6010,
      "name": "exceedsTotalCap",
      "msg": "Amount exceeds total spending cap"
    }
  ],
  "types": [
    {
      "name": "agentProfile",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "category",
            "type": "u8"
          },
          {
            "name": "description",
            "type": "string"
          },
          {
            "name": "pricingModelType",
            "type": "u8"
          },
          {
            "name": "pricingAmount",
            "type": "u64"
          },
          {
            "name": "capabilities",
            "type": {
              "vec": "string"
            }
          },
          {
            "name": "maxCap",
            "type": "u64"
          },
          {
            "name": "dailyCap",
            "type": "u64"
          },
          {
            "name": "totalCap",
            "type": "u64"
          },
          {
            "name": "dailySpent",
            "type": "u64"
          },
          {
            "name": "totalSpent",
            "type": "u64"
          },
          {
            "name": "isActive",
            "type": "bool"
          },
          {
            "name": "isVerified",
            "type": "bool"
          },
          {
            "name": "registrationTime",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "agentRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "category",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "spendingRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "dailySpent",
            "type": "u64"
          },
          {
            "name": "totalSpent",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
