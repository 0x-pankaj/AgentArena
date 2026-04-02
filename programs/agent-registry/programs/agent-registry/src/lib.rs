use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

declare_id!("CVwkvdnRgH4nwhySYFfousNBWGPT1TTrrFvz8R2fxrt6");

#[program]
pub mod agent_registry {
    use super::*;

    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        name: String,
        category: u8,
        description: String,
        pricing_model_type: u8,
        pricing_amount: u64,
        capabilities: Vec<String>,
        max_cap: u64,
        daily_cap: u64,
        total_cap: u64,
    ) -> Result<()> {
        require!(name.len() <= 100, AgentRegistryError::NameTooLong);
        require!(
            description.len() <= 500,
            AgentRegistryError::DescriptionTooLong
        );
        require!(category <= 2, AgentRegistryError::InvalidCategory);
        require!(
            capabilities.len() <= 10,
            AgentRegistryError::TooManyCapabilities
        );
        require!(max_cap > 0, AgentRegistryError::InvalidMaxCap);
        require!(daily_cap > 0, AgentRegistryError::InvalidDailyCap);
        require!(total_cap >= max_cap, AgentRegistryError::InvalidTotalCap);

        let agent = &mut ctx.accounts.agent_profile;
        agent.authority = ctx.accounts.owner.key();
        agent.name = name;
        agent.category = category;
        agent.description = description;
        agent.pricing_model_type = pricing_model_type;
        agent.pricing_amount = pricing_amount;
        agent.capabilities = capabilities;
        agent.max_cap = max_cap;
        agent.daily_cap = daily_cap;
        agent.total_cap = total_cap;
        agent.daily_spent = 0;
        agent.total_spent = 0;
        agent.is_active = true;
        agent.is_verified = false;
        agent.registration_time = Clock::get()?.unix_timestamp;
        agent.bump = ctx.bumps.agent_profile;

        emit!(AgentRegistered {
            agent: agent.key(),
            authority: agent.authority,
            name: agent.name.clone(),
            category: agent.category,
        });

        Ok(())
    }

    pub fn update_agent(
        ctx: Context<UpdateAgent>,
        name: Option<String>,
        description: Option<String>,
        pricing_model_type: Option<u8>,
        pricing_amount: Option<u64>,
        capabilities: Option<Vec<String>>,
        max_cap: Option<u64>,
        daily_cap: Option<u64>,
        total_cap: Option<u64>,
    ) -> Result<()> {
        let agent = &mut ctx.accounts.agent_profile;

        if let Some(n) = name {
            require!(n.len() <= 100, AgentRegistryError::NameTooLong);
            agent.name = n;
        }
        if let Some(d) = description {
            require!(d.len() <= 500, AgentRegistryError::DescriptionTooLong);
            agent.description = d;
        }
        if let Some(t) = pricing_model_type {
            agent.pricing_model_type = t;
        }
        if let Some(a) = pricing_amount {
            agent.pricing_amount = a;
        }
        if let Some(c) = capabilities {
            require!(c.len() <= 10, AgentRegistryError::TooManyCapabilities);
            agent.capabilities = c;
        }
        if let Some(mc) = max_cap {
            require!(mc > 0, AgentRegistryError::InvalidMaxCap);
            agent.max_cap = mc;
        }
        if let Some(dc) = daily_cap {
            require!(dc > 0, AgentRegistryError::InvalidDailyCap);
            agent.daily_cap = dc;
        }
        if let Some(tc) = total_cap {
            require!(tc >= agent.max_cap, AgentRegistryError::InvalidTotalCap);
            agent.total_cap = tc;
        }

        Ok(())
    }

    pub fn deactivate_agent(ctx: Context<UpdateAgent>) -> Result<()> {
        let agent = &mut ctx.accounts.agent_profile;
        agent.is_active = false;
        Ok(())
    }

    pub fn verify_agent(ctx: Context<VerifyAgent>) -> Result<()> {
        let agent = &mut ctx.accounts.agent_profile;
        agent.is_verified = true;
        Ok(())
    }

    pub fn reset_daily_spent(ctx: Context<ResetDailySpent>) -> Result<()> {
        let agent = &mut ctx.accounts.agent_profile;
        agent.daily_spent = 0;
        Ok(())
    }

    pub fn record_spending(ctx: Context<RecordSpending>, amount: u64) -> Result<()> {
        let agent = &mut ctx.accounts.agent_profile;

        require!(agent.is_active, AgentRegistryError::AgentNotActive);
        require!(amount <= agent.max_cap, AgentRegistryError::ExceedsMaxCap);
        require!(
            agent.daily_spent + amount <= agent.daily_cap,
            AgentRegistryError::ExceedsDailyCap
        );
        require!(
            agent.total_spent + amount <= agent.total_cap,
            AgentRegistryError::ExceedsTotalCap
        );

        agent.daily_spent += amount;
        agent.total_spent += amount;

        emit!(SpendingRecorded {
            agent: agent.key(),
            amount,
            daily_spent: agent.daily_spent,
            total_spent: agent.total_spent,
        });

        Ok(())
    }

    pub fn initialize_job(
        ctx: Context<InitializeJob>,
        agent_id: String,
        privy_wallet: Pubkey,
    ) -> Result<()> {
        require!(agent_id.len() <= 100, AgentRegistryError::JobIdTooLong);

        let job_profile = &mut ctx.accounts.job_profile;
        job_profile.user_pubkey = ctx.accounts.user.key();
        job_profile.agent_id = agent_id;
        job_profile.privy_wallet_pubkey = privy_wallet;
        job_profile.created_at = Clock::get()?.unix_timestamp;
        job_profile.bump = ctx.bumps.job_profile;

        emit!(JobRegistered {
            job: job_profile.key(),
            user: job_profile.user_pubkey,
            agent_id: job_profile.agent_id.clone(),
            privy_wallet: job_profile.privy_wallet_pubkey,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + AgentProfile::INIT_SPACE,
        seeds = [b"agent", owner.key().as_ref()],
        bump
    )]
    pub agent_profile: Account<'info, AgentProfile>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAgent<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_profile.authority.as_ref()],
        bump = agent_profile.bump,
        has_one = authority
    )]
    pub agent_profile: Account<'info, AgentProfile>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct VerifyAgent<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_profile.authority.as_ref()],
        bump = agent_profile.bump
    )]
    pub agent_profile: Account<'info, AgentProfile>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResetDailySpent<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_profile.authority.as_ref()],
        bump = agent_profile.bump,
        has_one = authority
    )]
    pub agent_profile: Account<'info, AgentProfile>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RecordSpending<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_profile.authority.as_ref()],
        bump = agent_profile.bump
    )]
    pub agent_profile: Account<'info, AgentProfile>,
}

#[derive(Accounts)]
#[instruction(agent_id: String)]
pub struct InitializeJob<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + JobProfile::INIT_SPACE,
        seeds = [b"job", user.key().as_ref(), &Sha256::digest(agent_id.as_bytes())],
        bump
    )]
    pub job_profile: Account<'info, JobProfile>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct AgentProfile {
    pub authority: Pubkey,
    #[max_len(100)]
    pub name: String,
    pub category: u8,
    #[max_len(500)]
    pub description: String,
    pub pricing_model_type: u8,
    pub pricing_amount: u64,
    #[max_len(10, 50)]
    pub capabilities: Vec<String>,
    pub max_cap: u64,
    pub daily_cap: u64,
    pub total_cap: u64,
    pub daily_spent: u64,
    pub total_spent: u64,
    pub is_active: bool,
    pub is_verified: bool,
    pub registration_time: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct JobProfile {
    pub user_pubkey: Pubkey,
    #[max_len(100)]
    pub agent_id: String,
    pub privy_wallet_pubkey: Pubkey,
    pub created_at: i64,
    pub bump: u8,
}

#[event]
pub struct AgentRegistered {
    pub agent: Pubkey,
    pub authority: Pubkey,
    pub name: String,
    pub category: u8,
}

#[event]
pub struct SpendingRecorded {
    pub agent: Pubkey,
    pub amount: u64,
    pub daily_spent: u64,
    pub total_spent: u64,
}

#[event]
pub struct JobRegistered {
    pub job: Pubkey,
    pub user: Pubkey,
    pub agent_id: String,
    pub privy_wallet: Pubkey,
}

#[error_code]
pub enum AgentRegistryError {
    #[msg("Agent name must be 100 characters or less")]
    NameTooLong,
    #[msg("Agent description must be 500 characters or less")]
    DescriptionTooLong,
    #[msg("Invalid category. Must be 0 (Geo), 1 (Politics), or 2 (Sports)")]
    InvalidCategory,
    #[msg("Too many capabilities. Maximum 10 allowed")]
    TooManyCapabilities,
    #[msg("Max cap must be greater than 0")]
    InvalidMaxCap,
    #[msg("Daily cap must be greater than 0")]
    InvalidDailyCap,
    #[msg("Total cap must be >= max cap")]
    InvalidTotalCap,
    #[msg("Agent is not active")]
    AgentNotActive,
    #[msg("Amount exceeds max cap per trade")]
    ExceedsMaxCap,
    #[msg("Amount exceeds daily spending cap")]
    ExceedsDailyCap,
    #[msg("Amount exceeds total spending cap")]
    ExceedsTotalCap,
    #[msg("Job ID must be 100 characters or less")]
    JobIdTooLong,
}
